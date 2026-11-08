import { beforeEach, describe, expect, it, vi } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import type { ImageContentType, UploadFolder } from "@/lib/storage";
import {
  getFoodPhotoUrl,
  saveFoodPhoto,
  type FoodPhotoInsert,
  type PhotoDonation,
  type PhotoStore,
  type PhotoTx,
} from "./donation-photo";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const OLD_KEY = "food/22222222-2222-4222-8222-222222222222.jpg";
const NEW_KEY = "food/33333333-3333-4333-8333-333333333333.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { contentType: "image/jpeg" as AllowedImageType, data: JPEG };

type ImageRow = FoodPhotoInsert & { id: string; deletedAt: Date | null };

/** In-memory store. `transaction` restores the image rows when `work` throws. */
class FakeStore implements PhotoStore {
  donations = new Map<string, PhotoDonation>();
  images: ImageRow[] = [];
  /** Returned by getDonationLocked instead of the stored row, to simulate a race. */
  lockOverride: PhotoDonation | null | undefined = undefined;
  insertError: Error | null = null;
  private seq = 0;

  seedDonation(id: string, donation: PhotoDonation): void {
    this.donations.set(id, donation);
  }

  seedImage(row: Partial<ImageRow> & Pick<ImageRow, "id" | "storageKey">): void {
    this.images.push({
      donationId: DONATION_ID,
      uploadedByUserId: DONOR_ID,
      mimeType: "image/jpeg",
      sizeBytes: 128,
      deletedAt: null,
      ...row,
    });
  }

  async transaction<T>(work: (tx: PhotoTx) => Promise<T>): Promise<T> {
    const snapshot = this.images.map((image) => ({ ...image }));
    try {
      return await work(this.createTx());
    } catch (error) {
      this.images = snapshot;
      throw error;
    }
  }

  async readDonation(id: string): Promise<PhotoDonation | null> {
    return this.donations.get(id) ?? null;
  }

  async findActiveFoodPhoto(donationId: string) {
    const image = this.images.find((row) => row.donationId === donationId && row.deletedAt === null);
    return image ? { storageKey: image.storageKey, mimeType: image.mimeType } : null;
  }

  private createTx(): PhotoTx {
    return {
      getDonationLocked: async (id) =>
        this.lockOverride !== undefined ? this.lockOverride : this.donations.get(id) ?? null,
      softDeleteActiveFoodPhoto: async (donationId) => {
        for (const image of this.images) {
          if (image.donationId === donationId && image.deletedAt === null) {
            image.deletedAt = new Date("2026-11-08T10:00:00.000Z");
          }
        }
      },
      insertFoodPhoto: async (row) => {
        if (this.insertError) throw this.insertError;
        this.seq += 1;
        const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
        this.images.push({ ...row, id, deletedAt: null });
        return { id };
      },
    };
  }
}

class FakeStorage {
  uploads: { folder: UploadFolder; contentType: ImageContentType; data: Uint8Array }[] = [];
  removed: string[] = [];
  removeError: Error | null = null;
  key = NEW_KEY;
  signedForKey: string | null = null;
  signedExpiry: number | null = null;

  async uploadImage(input: { folder: UploadFolder; contentType: ImageContentType; data: Uint8Array }) {
    this.uploads.push(input);
    return { key: this.key };
  }

  async removeObject(key: string): Promise<void> {
    if (this.removeError) throw this.removeError;
    this.removed.push(key);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.signedForKey = key;
    this.signedExpiry = expiresInSeconds;
    return SIGNED_URL;
  }
}

function draftDonation(donorId: string = DONOR_ID): PhotoDonation {
  return { donorId, status: DonationStatus.DRAFT, deletedAt: null };
}

function makeDeps() {
  return { store: new FakeStore(), storage: new FakeStorage() };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("saveFoodPhoto", () => {
  it("stores one row and one object for the first upload", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result).toEqual({ ok: true, imageId: expect.any(String) });
    expect(store.images).toHaveLength(1);
    expect(store.images[0]).toMatchObject({
      donationId: DONATION_ID,
      uploadedByUserId: DONOR_ID,
      storageKey: NEW_KEY,
      mimeType: "image/jpeg",
      sizeBytes: JPEG.byteLength,
      deletedAt: null,
    });
    expect(storage.uploads).toEqual([{ folder: "food", contentType: "image/jpeg", data: JPEG }]);
    expect(storage.removed).toEqual([]);
  });

  it("soft-deletes the old row on a retake and leaves exactly one active photo", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result.ok).toBe(true);
    expect(store.images).toHaveLength(2);
    const [oldRow, newRow] = store.images;
    expect(oldRow.storageKey).toBe(OLD_KEY);
    expect(oldRow.deletedAt).toBeInstanceOf(Date);
    expect(newRow.storageKey).toBe(NEW_KEY);
    expect(newRow.deletedAt).toBeNull();
    expect(store.images.filter((row) => row.deletedAt === null)).toHaveLength(1);
    // The old object stays in the bucket until a cleanup job exists.
    expect(storage.removed).toEqual([]);
    expect(storage.removed).not.toContain(OLD_KEY);
  });

  it.each([
    ["missing", undefined],
    ["deleted", { donorId: DONOR_ID, status: DonationStatus.DRAFT, deletedAt: new Date("2026-11-08T00:00:00.000Z") }],
    ["owned by another donor", draftDonation(OTHER_DONOR_ID)],
  ] as [string, PhotoDonation | undefined][])(
    "answers NOT_FOUND for a %s donation, without uploading",
    async (_label, donation) => {
      const { store, storage } = makeDeps();
      if (donation) store.seedDonation(DONATION_ID, donation);

      const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

      expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(storage.uploads).toEqual([]);
      expect(store.images).toEqual([]);
    },
  );

  it.each([DonationStatus.SCREENED, DonationStatus.POSTED] as const)(
    "answers NOT_EDITABLE for a %s donation, without uploading",
    async (status) => {
      const { store, storage } = makeDeps();
      store.seedDonation(DONATION_ID, { donorId: DONOR_ID, status, deletedAt: null });

      const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

      expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
      expect(storage.uploads).toEqual([]);
      expect(store.images).toEqual([]);
    },
  );

  it.each([
    ["NOT_FOUND", null],
    ["NOT_EDITABLE", { donorId: DONOR_ID, status: DonationStatus.POSTED, deletedAt: null }],
  ] as [string, PhotoDonation | null][])(
    "removes the uploaded object when the locked re-check refuses with %s",
    async (error, locked) => {
      const { store, storage } = makeDeps();
      store.seedDonation(DONATION_ID, draftDonation());
      store.lockOverride = locked;

      const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

      expect(result).toEqual({ ok: false, error });
      expect(storage.uploads).toHaveLength(1);
      expect(storage.removed).toEqual([NEW_KEY]);
      expect(store.images).toEqual([]);
    },
  );

  it("removes the uploaded object and rethrows when the insert fails", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.insertError = new Error("insert exploded");

    await expect(
      saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE }),
    ).rejects.toThrow("insert exploded");

    expect(storage.removed).toEqual([NEW_KEY]);
    expect(store.images).toEqual([]);
  });

  it("keeps the original error when the cleanup removal also fails, and never logs the key", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.insertError = new Error("insert exploded");
    storage.removeError = new Error("remove exploded");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE }),
    ).rejects.toThrow("insert exploded");

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("saveFoodPhoto: failed to remove the uploaded photo");
    expect(Object.keys(details as object)).toEqual(["cleanupError"]);
    expect(JSON.stringify(details)).not.toContain(NEW_KEY);
    expect(storage.removed).toEqual([]);
  });

  it("writes the caller's donor id on the new row", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());

    await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(store.images[0].uploadedByUserId).toBe(DONOR_ID);
  });
});

describe("getFoodPhotoUrl", () => {
  it("returns a 300-second signed URL for the owner, without the storage key", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-1", storageKey: OLD_KEY, mimeType: "image/webp" });

    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: true, url: SIGNED_URL, expiresInSeconds: 300, mimeType: "image/webp" });
    expect(result).not.toHaveProperty("storageKey");
    expect(JSON.stringify(result)).not.toContain(OLD_KEY);
    expect(storage.signedForKey).toBe(OLD_KEY);
    expect(storage.signedExpiry).toBe(300);
  });

  it("works for a donation that is no longer a draft", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, { donorId: DONOR_ID, status: DonationStatus.POSTED, deletedAt: null });
    store.seedImage({ id: "image-1", storageKey: OLD_KEY });

    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result.ok).toBe(true);
  });

  it("answers NOT_FOUND for another donor's donation", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation(OTHER_DONOR_ID));
    store.seedImage({ id: "image-1", storageKey: OLD_KEY });

    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.signedForKey).toBeNull();
  });

  it("answers NOT_FOUND for a discarded donation", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, {
      donorId: DONOR_ID,
      status: DonationStatus.DRAFT,
      deletedAt: new Date("2026-11-08T00:00:00.000Z"),
    });
    store.seedImage({ id: "image-1", storageKey: OLD_KEY });

    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.signedForKey).toBeNull();
  });

  it("answers NOT_FOUND when the donation has no photo", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());

    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.signedForKey).toBeNull();
  });

  it("does not return the soft-deleted photo after a retake", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());

    await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });
    const result = await getFoodPhotoUrl({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result.ok).toBe(true);
    expect(storage.signedForKey).toBe(NEW_KEY);
  });
});
