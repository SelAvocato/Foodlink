import { describe, expect, it, vi } from "vitest";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import type { ImageContentType, UploadFolder } from "@/lib/storage";
import type { ScreeningInsert } from "@/server/screening/screen-draft-photo";
import type { ScreeningProvider } from "@/server/screening/screening-provider";
import {
  savePickupPhoto,
  type PickupPhotoDonation,
  type PickupPhotoInsert,
  type PickupPhotoStore,
  type PickupPhotoStorage,
  type PickupPhotoTx,
  type SavePickupPhotoDeps,
} from "./pickup-photo";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const NEW_KEY = "pickup/22222222-2222-4222-8222-222222222222.jpg";
const OLD_KEY = "pickup/55555555-5555-4555-8555-555555555555.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";
const RETIRED_AT = new Date("2026-11-17T09:30:00.000Z");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const FILE = { contentType: "image/jpeg" as AllowedImageType, data: JPEG };
const PASS_REPLY = { verdict: "PASS", confidence: 0.93, signs: ["Packaging is clean"] };

type ImageRow = PickupPhotoInsert & { id: string; deletedAt: Date | null };
type ScreeningRow = ScreeningInsert & { id: string };

let seq = 0;

function donation(overrides: Partial<PickupPhotoDonation> = {}): PickupPhotoDonation {
  return { status: DonationStatus.ASSIGNED, deletedAt: null, ...overrides };
}

/** In-memory store. `transaction` restores the rows when `work` throws. */
class FakeStore implements PickupPhotoStore {
  donations = new Map<string, PickupPhotoDonation>([[DONATION_ID, donation()]]);
  currentVolunteerId: string | null = VOLUNTEER_ID;
  scan = true;
  inspection = false;
  scanCalls: { donationId: string; volunteerId: string }[] = [];
  images: ImageRow[] = [];
  screenings: ScreeningRow[] = [];
  /** Values the locked transaction sees instead, to simulate a race. */
  atLock:
    | {
        donation?: PickupPhotoDonation | null;
        volunteerId?: string | null;
        scan?: boolean;
        inspection?: boolean;
      }
    | undefined = undefined;
  insertError: Error | null = null;

  /** Shared with FakeStorage so a test can assert commit-before-remove order. */
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

  async transaction<T>(work: (tx: PickupPhotoTx) => Promise<T>): Promise<T> {
    const images = this.images.map((row) => ({ ...row }));
    const screenings = this.screenings.map((row) => ({ ...row }));
    try {
      const result = await work(this.createTx());
      this.log.push("commit");
      return result;
    } catch (error) {
      this.images = images;
      this.screenings = screenings;
      throw error;
    }
  }

  async readDonation(): Promise<PickupPhotoDonation | null> {
    return this.donations.get(DONATION_ID) ?? null;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async hasPickupScan(donationId: string, volunteerId: string): Promise<boolean> {
    this.scanCalls.push({ donationId, volunteerId });
    return this.scan;
  }

  async hasInspection(): Promise<boolean> {
    return this.inspection;
  }

  private createTx(): PickupPhotoTx {
    const at = this.atLock;
    return {
      getDonationLocked: async (id) =>
        at && "donation" in at ? (at.donation ?? null) : (this.donations.get(id) ?? null),
      findCurrentVolunteerId: async () =>
        at && "volunteerId" in at ? (at.volunteerId ?? null) : this.currentVolunteerId,
      hasPickupScan: async (donationId, volunteerId) => {
        this.scanCalls.push({ donationId, volunteerId });
        return at?.scan ?? this.scan;
      },
      hasInspection: async () => at?.inspection ?? this.inspection,
      softDeleteActivePickupPhoto: async (donationId) => {
        const active = this.images.filter(
          (row) => row.donationId === donationId && row.deletedAt === null,
        );
        for (const image of active) image.deletedAt = RETIRED_AT;
        return active.map((image) => image.storageKey);
      },
      insertPickupPhoto: async (row) => {
        const image: ImageRow = { ...row, id: `image-${++seq}`, deletedAt: null };
        this.images.push(image);
        return { id: image.id };
      },
      insertScreening: async (row) => {
        if (this.insertError) throw this.insertError;
        const screening: ScreeningRow = { ...row, id: `screening-${++seq}` };
        this.screenings.push(screening);
        return { id: screening.id };
      },
    };
  }
}

/** Records uploads, signed URLs and removals; the log is shared with FakeStore. */
class FakeStorage implements PickupPhotoStorage {
  uploads: { folder: UploadFolder; contentType: ImageContentType; bytes: number }[] = [];
  signed: { key: string; seconds: number }[] = [];
  removed: string[] = [];
  uploadError: Error | null = null;

  constructor(private readonly log: string[] = []) {}

  async uploadImage(input: {
    folder: UploadFolder;
    contentType: ImageContentType;
    data: Uint8Array;
  }): Promise<{ key: string }> {
    if (this.uploadError) throw this.uploadError;
    this.uploads.push({
      folder: input.folder,
      contentType: input.contentType,
      bytes: input.data.byteLength,
    });
    this.log.push("upload");
    return { key: NEW_KEY };
  }

  async getSignedUrl(key: string, seconds = 300): Promise<string> {
    this.signed.push({ key, seconds });
    return SIGNED_URL;
  }

  async removeObject(key: string): Promise<void> {
    this.removed.push(key);
    this.log.push(`remove:${key}`);
  }
}

function makeProvider(reply: unknown = PASS_REPLY): ScreeningProvider {
  return {
    name: "fake-provider",
    modelVersion: "test-1",
    screen: vi.fn(async () => reply),
  };
}

function setup() {
  const log: string[] = [];
  const store = new FakeStore(log);
  const storage = new FakeStorage(log);
  const provider = makeProvider();
  const deps: SavePickupPhotoDeps = { store, storage, provider };
  return { log, store, storage, provider, deps };
}

function save(deps: SavePickupPhotoDeps) {
  return savePickupPhoto(deps, { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, file: FILE });
}

describe("savePickupPhoto", () => {
  it("uploads, screens and stores the pickup photo", async () => {
    const { store, storage, provider, deps } = setup();

    const result = await save(deps);

    expect(result).toEqual({
      ok: true,
      verdict: ScreeningVerdict.PASS,
      screeningId: expect.any(String),
    });
    expect(storage.uploads).toEqual([
      { folder: "pickup", contentType: "image/jpeg", bytes: JPEG.byteLength },
    ]);
    expect(storage.signed).toEqual([{ key: NEW_KEY, seconds: 60 }]);
    expect(provider.screen).toHaveBeenCalledExactlyOnceWith({
      imageUrl: SIGNED_URL,
      mimeType: "image/jpeg",
    });
    expect(store.images).toHaveLength(1);
    expect(store.images[0]).toMatchObject({
      donationId: DONATION_ID,
      uploadedByUserId: VOLUNTEER_ID,
      storageKey: NEW_KEY,
      mimeType: "image/jpeg",
      sizeBytes: JPEG.byteLength,
      deletedAt: null,
    });
    expect(store.screenings[0]).toMatchObject({
      donationId: DONATION_ID,
      imageId: store.images[0].id,
      provider: "fake-provider",
      modelVersion: "test-1",
      verdict: ScreeningVerdict.PASS,
      confidence: 0.93,
      signs: ["Packaging is clean"],
      notes: null,
    });
  });

  it("never returns the storage key or the signed URL", async () => {
    const { deps } = setup();

    const result = await save(deps);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(NEW_KEY);
    expect(serialized).not.toContain("fake-token");
  });

  it("requires the volunteer's own PICKUP scan", async () => {
    const { store, storage, provider, deps } = setup();
    store.scan = false;

    const result = await save(deps);

    expect(result).toEqual({ ok: false, error: "SCAN_REQUIRED" });
    expect(store.scanCalls[0]).toEqual({ donationId: DONATION_ID, volunteerId: VOLUNTEER_ID });
    expect(storage.uploads).toEqual([]);
    expect(provider.screen).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown donation", (store: FakeStore) => store.donations.clear()],
    ["a discarded donation", (store: FakeStore) => store.donations.set(DONATION_ID, donation({ deletedAt: RETIRED_AT }))],
    ["another volunteer's assignment", (store: FakeStore) => (store.currentVolunteerId = OTHER_VOLUNTEER_ID)],
    ["no current assignment", (store: FakeStore) => (store.currentVolunteerId = null)],
  ])("answers NOT_FOUND for %s", async (_label, arrange) => {
    const { store, storage, provider, deps } = setup();
    arrange(store);

    const result = await save(deps);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.uploads).toEqual([]);
    expect(provider.screen).not.toHaveBeenCalled();
  });

  it("answers INVALID_STATE when the donation is no longer ASSIGNED", async () => {
    const { store, storage, deps } = setup();
    store.donations.set(DONATION_ID, donation({ status: DonationStatus.POSTED }));

    expect(await save(deps)).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(storage.uploads).toEqual([]);
  });

  it("answers INVALID_STATE once an inspection is saved", async () => {
    const { store, storage, deps } = setup();
    store.inspection = true;

    expect(await save(deps)).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(storage.uploads).toEqual([]);
  });

  it("retires the previous pickup photo and removes it after the commit", async () => {
    const { log, store, storage, deps } = setup();
    store.seedImage({ id: "old-image", storageKey: OLD_KEY });

    const result = await save(deps);

    expect(result.ok).toBe(true);
    const old = store.images.find((row) => row.storageKey === OLD_KEY);
    expect(old?.deletedAt).toEqual(RETIRED_AT);
    expect(store.images.filter((row) => row.deletedAt === null).map((row) => row.storageKey)).toEqual([
      NEW_KEY,
    ]);
    expect(storage.removed).toEqual([OLD_KEY]);
    expect(log.indexOf("commit")).toBeLessThan(log.indexOf(`remove:${OLD_KEY}`));
  });

  it("removes the fresh upload when a race refuses the save", async () => {
    const { store, storage, deps } = setup();
    store.seedImage({ id: "old-image", storageKey: OLD_KEY });
    store.atLock = { donation: donation({ status: DonationStatus.PICKED_UP }) };

    const result = await save(deps);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(storage.removed).toEqual([NEW_KEY]);
    expect(store.images.find((row) => row.storageKey === OLD_KEY)?.deletedAt).toBeNull();
    expect(store.screenings).toEqual([]);
  });

  it("re-checks the scan under the lock", async () => {
    const { store, storage, deps } = setup();
    store.atLock = { scan: false };

    const result = await save(deps);

    expect(result).toEqual({ ok: false, error: "SCAN_REQUIRED" });
    expect(storage.removed).toEqual([NEW_KEY]);
  });

  it("removes the fresh upload and rethrows when the transaction fails", async () => {
    const { store, storage, deps } = setup();
    store.insertError = new Error(`insert failed for ${NEW_KEY}`);

    await expect(save(deps)).rejects.toThrow("insert failed");

    expect(storage.removed).toEqual([NEW_KEY]);
    expect(store.images).toEqual([]);
    expect(store.screenings).toEqual([]);
  });

  it("does not screen when the upload fails", async () => {
    const { store, storage, provider, deps } = setup();
    storage.uploadError = new Error("storage down");

    await expect(save(deps)).rejects.toThrow("storage down");

    expect(provider.screen).not.toHaveBeenCalled();
    expect(store.screenings).toEqual([]);
  });

  it("stores REVIEW with the timeout note", async () => {
    const { store, deps } = setup();
    deps.provider = {
      name: "slow",
      modelVersion: null,
      screen: () => new Promise(() => {}),
    };
    deps.timeoutMs = 5;

    const result = await save(deps);

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW });
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.REVIEW,
      confidence: null,
      signs: [],
      notes: "Provider timed out.",
    });
  });

  it("stores REVIEW for a malformed reply", async () => {
    const { store, deps } = setup();
    deps.provider = makeProvider({ verdict: "PASS" });

    expect(await save(deps)).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW });
    expect(store.screenings[0]).toMatchObject({ notes: "Provider reply was malformed." });
  });

  it("stores REVIEW below the confidence threshold", async () => {
    const { store, deps } = setup();
    deps.provider = makeProvider({ verdict: "PASS", confidence: 0.5, signs: [] });

    expect(await save(deps)).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW });
    expect(store.screenings[0]).toMatchObject({
      confidence: 0.5,
      notes: "Confidence below the review threshold.",
    });
  });

  it("stores REVIEW and logs only a safe summary when the provider throws", async () => {
    const { store, deps } = setup();
    deps.provider = {
      name: "broken",
      modelVersion: null,
      screen: async () => {
        throw new Error(`provider failed for ${SIGNED_URL}`);
      },
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await save(deps);

      expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW });
      expect(store.screenings[0]).toMatchObject({ notes: "Provider failed." });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("provider failed for");
      expect(logged).not.toContain("fake-token");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps a FLAG verdict and cleans the provider signs", async () => {
    const { store, deps } = setup();
    deps.provider = makeProvider({
      verdict: "FLAG",
      confidence: 0.88,
      signs: ["<b>mold</b> spots", "   "],
    });

    const result = await save(deps);

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.FLAG });
    const signs = store.screenings[0].signs;
    expect(signs).toHaveLength(1);
    expect(signs[0]).toContain("mold");
    expect(signs[0]).not.toContain("<");
  });
});
