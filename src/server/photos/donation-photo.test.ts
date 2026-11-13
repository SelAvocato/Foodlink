import { beforeEach, describe, expect, it, vi } from "vitest";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
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
  /** Returned by tx.hasPendingReview instead of the stored rows, to simulate a race. */
  pendingReviewAtLock: boolean | undefined = undefined;
  /** Returned by tx.hasDecidedScreeningForActivePhoto instead of the stored rows, to simulate a race. */
  decidedScreeningAtLock: boolean | undefined = undefined;
  /** The screening rows that decide the retake block. */
  screenings: { imageId: string | null; verdict: ScreeningVerdict; reviewedAt: Date | null }[] = [];
  insertError: Error | null = null;
  private seq = 0;

  /** Shared with FakeStorage so a test can assert commit-before-remove order. */
  constructor(private readonly log: string[] = []) {}

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
      const result = await work(this.createTx());
      // The rows are committed here, mirroring the real transaction boundary.
      this.log.push("commit");
      return result;
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

  async hasPendingReview(): Promise<boolean> {
    return this.anyPendingReview();
  }

  async hasDecidedScreeningForActivePhoto(donationId: string): Promise<boolean> {
    return this.anyDecidedScreening(donationId);
  }

  /** The database rule: a row with verdict REVIEW and reviewed_at null. */
  private anyPendingReview(): boolean {
    return this.screenings.some(
      (row) => row.verdict === ScreeningVerdict.REVIEW && row.reviewedAt === null,
    );
  }

  /** The database rule: a PASS or FLAG row on the donation's active FOOD_PHOTO. */
  private anyDecidedScreening(donationId: string): boolean {
    const active = this.images.find((row) => row.donationId === donationId && row.deletedAt === null);
    if (!active) return false;
    return this.screenings.some(
      (row) =>
        row.imageId === active.id &&
        (row.verdict === ScreeningVerdict.PASS || row.verdict === ScreeningVerdict.FLAG),
    );
  }

  private createTx(): PhotoTx {
    return {
      getDonationLocked: async (id) =>
        this.lockOverride !== undefined ? this.lockOverride : this.donations.get(id) ?? null,
      softDeleteActiveFoodPhoto: async (donationId) => {
        const retired = this.images.filter(
          (image) => image.donationId === donationId && image.deletedAt === null,
        );
        for (const image of retired) {
          image.deletedAt = new Date("2026-11-08T10:00:00.000Z");
        }
        return retired[0]?.storageKey ?? null;
      },
      insertFoodPhoto: async (row) => {
        if (this.insertError) throw this.insertError;
        this.seq += 1;
        const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
        this.images.push({ ...row, id, deletedAt: null });
        return { id };
      },
      hasPendingReview: async () =>
        this.pendingReviewAtLock !== undefined ? this.pendingReviewAtLock : this.anyPendingReview(),
      hasDecidedScreeningForActivePhoto: async (donationId) =>
        this.decidedScreeningAtLock !== undefined
          ? this.decidedScreeningAtLock
          : this.anyDecidedScreening(donationId),
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

  /** Shared with FakeStore so a test can assert commit-before-remove order. */
  constructor(private readonly log: string[] = []) {}

  async uploadImage(input: { folder: UploadFolder; contentType: ImageContentType; data: Uint8Array }) {
    this.uploads.push(input);
    return { key: this.key };
  }

  async removeObject(key: string): Promise<void> {
    if (this.removeError) throw this.removeError;
    this.removed.push(key);
    this.log.push(`remove:${key}`);
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
  const log: string[] = [];
  return { store: new FakeStore(log), storage: new FakeStorage(log), log };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("saveFoodPhoto", () => {
  it("stores one row and one object for the first upload", async () => {
    const { store, storage, log } = makeDeps();
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
    // No old key existed, so nothing but the commit is ever recorded.
    expect(log).toEqual(["commit"]);
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
    // The old object is removed after the commit; only the new one stays.
    expect(storage.removed).toEqual([OLD_KEY]);
  });

  it("removes the old object once, after the commit, on a retake", async () => {
    const { store, storage, log } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result.ok).toBe(true);
    expect(storage.removed).toEqual([OLD_KEY]);
    // Commit first, delete second: the removal must never precede the commit.
    expect(log).toEqual(["commit", `remove:${OLD_KEY}`]);
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

  it("answers REVIEW_PENDING before any upload while a review is pending", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.screenings.push({ imageId: null, verdict: ScreeningVerdict.REVIEW, reviewedAt: null });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result).toEqual({ ok: false, error: "REVIEW_PENDING" });
    expect(storage.uploads).toEqual([]);
    expect(store.images).toEqual([]);
  });

  it("removes the uploaded object when a review opens before the locked re-check", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.pendingReviewAtLock = true;

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result).toEqual({ ok: false, error: "REVIEW_PENDING" });
    expect(storage.uploads).toHaveLength(1);
    expect(storage.removed).toEqual([NEW_KEY]);
    expect(store.images).toEqual([]);
  });

  it("removes only the new object when a review opens at the lock, with an old photo in place", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });
    store.pendingReviewAtLock = true;

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result).toEqual({ ok: false, error: "REVIEW_PENDING" });
    expect(storage.removed).toEqual([NEW_KEY]);
    expect(storage.removed).not.toContain(OLD_KEY);
    // The refusal happens before the soft delete, so the old row stays active.
    expect(store.images[0].deletedAt).toBeNull();
  });

  it("allows a retake when the active photo has no screening", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-active", storageKey: OLD_KEY });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result.ok).toBe(true);
    expect(storage.uploads).toHaveLength(1);
    expect(store.images.filter((row) => row.deletedAt === null)).toHaveLength(1);
  });

  it("allows a retake when the active photo has only a reviewed REVIEW screening", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-active", storageKey: OLD_KEY });
    store.screenings.push({
      imageId: "image-active",
      verdict: ScreeningVerdict.REVIEW,
      reviewedAt: new Date("2026-11-09T00:00:00.000Z"),
    });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result.ok).toBe(true);
    expect(storage.uploads).toHaveLength(1);
  });

  it("allows a retake when the screening belongs to an older, soft-deleted image", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY, deletedAt: new Date("2026-11-08T10:00:00.000Z") });
    store.seedImage({ id: "image-active", storageKey: NEW_KEY });
    store.screenings.push({ imageId: "image-old", verdict: ScreeningVerdict.FLAG, reviewedAt: null });

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result.ok).toBe(true);
    expect(storage.uploads).toHaveLength(1);
    expect(store.images.filter((row) => row.deletedAt === null)).toHaveLength(1);
  });

  it.each([[ScreeningVerdict.PASS], [ScreeningVerdict.FLAG]] as const)(
    "answers NOT_EDITABLE before any upload when the active photo has a %s screening",
    async (verdict) => {
      const { store, storage } = makeDeps();
      store.seedDonation(DONATION_ID, draftDonation());
      store.seedImage({ id: "image-active", storageKey: OLD_KEY });
      store.screenings.push({ imageId: "image-active", verdict, reviewedAt: null });

      const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

      expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
      expect(storage.uploads).toEqual([]);
      expect(store.images).toHaveLength(1);
      expect(store.images[0].deletedAt).toBeNull();
    },
  );

  it("removes the uploaded object when a decided screening appears before the locked re-check", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-active", storageKey: OLD_KEY });
    store.decidedScreeningAtLock = true;

    const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(storage.uploads).toHaveLength(1);
    expect(storage.removed).toEqual([NEW_KEY]);
    expect(store.images).toHaveLength(1);
    expect(store.images[0].deletedAt).toBeNull();
  });

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

  it("removes only the new object when the transaction throws with an old photo in place", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });
    store.insertError = new Error("insert exploded");

    await expect(
      saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE }),
    ).rejects.toThrow("insert exploded");

    // The commit never happened, so the old file must survive the rollback.
    expect(storage.removed).toEqual([NEW_KEY]);
    expect(storage.removed).not.toContain(OLD_KEY);
    expect(store.images[0].deletedAt).toBeNull();
  });

  it("keeps the original error when the cleanup removal also fails, and never logs the key", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.insertError = new Error("insert exploded");
    // A storage or Prisma error can carry the key and the signed URL in its message.
    const cleanupMessage = `remove exploded for ${NEW_KEY} at ${SIGNED_URL}`;
    storage.removeError = new Error(cleanupMessage);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE }),
      ).rejects.toThrow("insert exploded");

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("saveFoodPhoto: failed to remove the uploaded photo");
      expect(Object.keys(details as object)).toEqual(["errorName"]);
      expect(details).toEqual({ errorName: "Error" });

      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(NEW_KEY);
      expect(logged).not.toContain(SIGNED_URL);
      expect(logged).not.toContain(cleanupMessage);
      expect(storage.removed).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logs the error name and code of a cleanup failure, without the key", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.insertError = new Error("insert exploded");
    storage.removeError = Object.assign(new Error(`remove exploded for ${NEW_KEY}`), { code: "P2025" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE }),
      ).rejects.toThrow("insert exploded");

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [, details] = consoleError.mock.calls[0];
      expect(Object.keys(details as object)).toEqual(["errorName", "errorCode"]);
      expect(details).toEqual({ errorName: "Error", errorCode: "P2025" });
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(NEW_KEY);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the result ok when removing the old object fails, and logs without the key", async () => {
    const { store, storage } = makeDeps();
    store.seedDonation(DONATION_ID, draftDonation());
    store.seedImage({ id: "image-old", storageKey: OLD_KEY });
    // A storage error can carry the old key and a signed URL in its message.
    const removalMessage = `remove exploded for ${OLD_KEY} at ${SIGNED_URL}`;
    storage.removeError = new Error(removalMessage);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await saveFoodPhoto({ store, storage }, { donorId: DONOR_ID, donationId: DONATION_ID, file: FILE });

      // The photo is committed either way; a failed removal only leaves the old file.
      expect(result).toEqual({ ok: true, imageId: expect.any(String) });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("saveFoodPhoto: failed to remove the retired photo");
      expect(details).toEqual({ errorName: "Error" });

      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(OLD_KEY);
      expect(logged).not.toContain(NEW_KEY);
      expect(logged).not.toContain(SIGNED_URL);
      expect(logged).not.toContain(removalMessage);
      expect(store.images.filter((row) => row.deletedAt === null)).toHaveLength(1);
    } finally {
      consoleError.mockRestore();
    }
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
