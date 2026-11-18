import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import type { ImageContentType, UploadFolder } from "@/lib/storage";
import {
  saveHandoverPhoto,
  type HandoverPhotoDonation,
  type HandoverPhotoInsert,
  type HandoverPhotoStore,
  type HandoverPhotoStorage,
  type HandoverPhotoTx,
} from "./handover-photo";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const NEW_KEY = "handover/22222222-2222-4222-8222-222222222222.jpg";
const OLD_KEY = "handover/55555555-5555-4555-8555-555555555555.jpg";
const UPLOADED_AT = new Date("2026-11-18T09:30:00.000Z");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { contentType: "image/jpeg" as AllowedImageType, data: JPEG };

type ImageRow = HandoverPhotoInsert & { id: string; deletedAt: Date | null };

function donation(overrides: Partial<HandoverPhotoDonation> = {}): HandoverPhotoDonation {
  return { status: DonationStatus.PICKED_UP, deletedAt: null, ...overrides };
}

class FakeStore implements HandoverPhotoStore {
  current: HandoverPhotoDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  atLock: { donation?: HandoverPhotoDonation | null; volunteerId?: string | null } | undefined;
  images: ImageRow[] = [];
  insertError: Error | null = null;

  constructor(private readonly log: string[] = []) {}

  seedImage(row: Partial<ImageRow> & Pick<ImageRow, "id" | "storageKey">): void {
    this.images.push({
      donationId: DONATION_ID,
      uploadedByUserId: VOLUNTEER_ID,
      mimeType: "image/jpeg",
      sizeBytes: 128,
      deletedAt: null,
      ...row,
    });
  }

  async readDonation(): Promise<HandoverPhotoDonation | null> {
    return this.current;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async transaction<T>(work: (tx: HandoverPhotoTx) => Promise<T>): Promise<T> {
    const snapshot = this.images.map((row) => ({ ...row }));
    try {
      const result = await work(this.createTx());
      this.log.push("commit");
      return result;
    } catch (error) {
      this.images = snapshot;
      throw error;
    }
  }

  private createTx(): HandoverPhotoTx {
    const at = this.atLock;
    return {
      getDonationLocked: async () =>
        at && "donation" in at ? (at.donation ?? null) : this.current,
      findCurrentVolunteerId: async () =>
        at && "volunteerId" in at ? (at.volunteerId ?? null) : this.currentVolunteerId,
      softDeleteActiveHandoverPhoto: async () => {
        const active = this.images.filter((row) => row.deletedAt === null);
        for (const image of active) image.deletedAt = UPLOADED_AT;
        return active.map((image) => image.storageKey);
      },
      insertHandoverPhoto: async (row) => {
        if (this.insertError) throw this.insertError;
        const image = { ...row, id: `image-${this.images.length + 1}`, deletedAt: null };
        this.images.push(image);
        return { id: image.id, createdAt: UPLOADED_AT };
      },
    };
  }
}

class FakeStorage implements HandoverPhotoStorage {
  uploads: { folder: UploadFolder; contentType: ImageContentType; bytes: number }[] = [];
  removals: string[] = [];

  constructor(private readonly log: string[] = []) {}

  async uploadImage(input: {
    folder: UploadFolder;
    contentType: ImageContentType;
    data: Uint8Array;
  }): Promise<{ key: string }> {
    this.uploads.push({
      folder: input.folder,
      contentType: input.contentType,
      bytes: input.data.byteLength,
    });
    return { key: NEW_KEY };
  }

  async removeObject(key: string): Promise<void> {
    this.removals.push(key);
    this.log.push(`remove:${key}`);
  }
}

function save(store: FakeStore, storage: FakeStorage = new FakeStorage(), volunteerId = VOLUNTEER_ID) {
  return saveHandoverPhoto(
    { store, storage },
    { volunteerId, donationId: DONATION_ID, file: FILE },
  );
}

describe("saveHandoverPhoto", () => {
  it.each([DonationStatus.PICKED_UP, DonationStatus.DELIVERED])(
    "uploads the proof while %s without screening it",
    async (status) => {
      const store = new FakeStore();
      store.current = donation({ status });
      const storage = new FakeStorage();

      const result = await save(store, storage);

      expect(result).toEqual({ ok: true, uploadedAt: UPLOADED_AT });
      expect(storage.uploads).toEqual([
        { folder: "handover", contentType: "image/jpeg", bytes: JPEG.byteLength },
      ]);
      expect(store.images).toHaveLength(1);
      expect(store.images[0]).toMatchObject({
        donationId: DONATION_ID,
        uploadedByUserId: VOLUNTEER_ID,
        storageKey: NEW_KEY,
        mimeType: "image/jpeg",
        sizeBytes: JPEG.byteLength,
      });
    },
  );

  it("retakes the proof: retires the active row and removes the old file after the commit", async () => {
    const log: string[] = [];
    const store = new FakeStore(log);
    const storage = new FakeStorage(log);
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });

    const result = await save(store, storage);

    expect(result.ok).toBe(true);
    expect(store.images.filter((row) => row.deletedAt === null)).toHaveLength(1);
    expect(store.images.find((row) => row.id === "image-old")?.deletedAt).toEqual(UPLOADED_AT);
    expect(storage.removals).toEqual([OLD_KEY]);
    expect(log).toEqual(["commit", `remove:${OLD_KEY}`]);
  });

  it.each([
    DonationStatus.DRAFT,
    DonationStatus.ASSIGNED,
    DonationStatus.CLOSED,
    DonationStatus.REJECTED_AT_PICKUP,
  ])("refuses to upload while %s", async (status) => {
    const store = new FakeStore();
    store.current = donation({ status });
    const storage = new FakeStorage();

    const result = await save(store, storage);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(storage.uploads).toEqual([]);
  });

  it("answers NOT_FOUND for a missing, deleted or foreign donation", async () => {
    const missing = new FakeStore();
    missing.current = null;
    expect(await save(missing)).toEqual({ ok: false, error: "NOT_FOUND" });

    const deleted = new FakeStore();
    deleted.current = donation({ deletedAt: new Date("2026-11-18T08:00:00.000Z") });
    expect(await save(deleted)).toEqual({ ok: false, error: "NOT_FOUND" });

    const foreign = new FakeStore();
    foreign.currentVolunteerId = OTHER_VOLUNTEER_ID;
    expect(await save(foreign)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("re-checks the status under the lock and removes the uploaded file on refusal", async () => {
    const store = new FakeStore();
    store.atLock = { donation: donation({ status: DonationStatus.CLOSED }) };
    const storage = new FakeStorage();

    const result = await save(store, storage);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(storage.removals).toEqual([NEW_KEY]);
    expect(store.images).toEqual([]);
  });

  it("re-checks the assignment under the lock", async () => {
    const store = new FakeStore();
    store.atLock = { volunteerId: OTHER_VOLUNTEER_ID };
    const storage = new FakeStorage();

    expect(await save(store, storage)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.removals).toEqual([NEW_KEY]);
  });

  it("rolls back the swap and removes the uploaded file when the insert fails", async () => {
    const store = new FakeStore();
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });
    store.insertError = new Error("insert failed");
    const storage = new FakeStorage();

    await expect(save(store, storage)).rejects.toThrow("insert failed");

    expect(store.images).toHaveLength(1);
    expect(store.images[0]).toMatchObject({ id: "image-old", deletedAt: null });
    expect(storage.removals).toEqual([NEW_KEY]);
  });
});
