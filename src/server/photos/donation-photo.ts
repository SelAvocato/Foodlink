import { DonationStatus } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import { safeErrorSummary } from "@/lib/safe-error";
import { DEFAULT_SIGNED_URL_SECONDS, type Storage } from "@/lib/storage";

/** The donation facts both paths need: who owns it, whether it is live, its status. */
export type PhotoDonation = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
};

/** A row as the read path needs it. The key stays inside the service. */
export type StoredFoodPhoto = {
  storageKey: string;
  mimeType: AllowedImageType;
};

export type FoodPhotoInsert = {
  donationId: string;
  uploadedByUserId: string;
  storageKey: string;
  mimeType: AllowedImageType;
  sizeBytes: number;
};

export interface PhotoTx {
  /** FOR UPDATE: a retake must not race a status change or a second upload. */
  getDonationLocked(id: string): Promise<PhotoDonation | null>;
  /** Soft-deletes the donation's active FOOD_PHOTO row; returns the retired row's storage key, or null if there was none. */
  softDeleteActiveFoodPhoto(donationId: string): Promise<string | null>;
  insertFoodPhoto(row: FoodPhotoInsert): Promise<{ id: string }>;
  /** A food_screenings row with verdict REVIEW and reviewed_at null for the donation. */
  hasPendingReview(donationId: string): Promise<boolean>;
  /** A PASS or FLAG screening row on the donation's active FOOD_PHOTO. */
  hasDecidedScreeningForActivePhoto(donationId: string): Promise<boolean>;
}

export interface PhotoStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: PhotoTx) => Promise<T>): Promise<T>;
  /** Plain read outside any transaction: ownership before any upload. */
  readDonation(id: string): Promise<PhotoDonation | null>;
  findActiveFoodPhoto(donationId: string): Promise<StoredFoodPhoto | null>;
  /** Plain read: while a REVIEW verdict waits for an Admin, the photo must not change. */
  hasPendingReview(donationId: string): Promise<boolean>;
  /** Plain read: after PASS or FLAG the active photo must not change either. */
  hasDecidedScreeningForActivePhoto(donationId: string): Promise<boolean>;
}

export type PhotoUploadStorage = Pick<Storage, "uploadImage" | "removeObject">;
export type PhotoUrlStorage = Pick<Storage, "getSignedUrl">;

export type SaveFoodPhotoResult =
  | { ok: true; imageId: string }
  | { ok: false; error: "NOT_FOUND" | "NOT_EDITABLE" | "REVIEW_PENDING" };

export type GetFoodPhotoUrlResult =
  | { ok: true; url: string; expiresInSeconds: number; mimeType: AllowedImageType }
  | { ok: false; error: "NOT_FOUND" };

/**
 * Best effort: a failed cleanup must not replace the original outcome, and the
 * key never reaches the log — `failure` is a constant label and only the safe
 * summary of the caught error is logged.
 */
async function removePhoto(storage: PhotoUploadStorage, key: string, failure: string): Promise<void> {
  try {
    await storage.removeObject(key);
  } catch (cleanupError) {
    console.error(failure, { ...safeErrorSummary(cleanupError) });
  }
}

/**
 * Uploads the donor's one food photo, or replaces the current one (a retake).
 * Only a DRAFT donation may change: the photo is locked once the donation is
 * SCREENED and while a REVIEW verdict waits for an Admin. donations.status is
 * never written here.
 */
export async function saveFoodPhoto(
  deps: { store: PhotoStore; storage: PhotoUploadStorage },
  args: { donorId: string; donationId: string; file: { contentType: AllowedImageType; data: Uint8Array } },
): Promise<SaveFoodPhotoResult> {
  const { donorId, donationId, file } = args;

  // A plain read first: a foreign or locked draft must never cause an upload.
  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.donorId !== donorId || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.DRAFT) {
    return { ok: false, error: "NOT_EDITABLE" };
  }
  // The Admin reviews exactly the photo the donor sees: while a REVIEW verdict
  // is pending the photo is frozen, before any upload happens.
  if (await deps.store.hasPendingReview(donationId)) {
    return { ok: false, error: "REVIEW_PENDING" };
  }
  // After PASS or FLAG the donation is about to leave DRAFT, and a retake
  // between the screening insert and the transition would put an unscreened
  // photo on a screened donation.
  if (await deps.store.hasDecidedScreeningForActivePhoto(donationId)) {
    return { ok: false, error: "NOT_EDITABLE" };
  }

  const { key } = await deps.storage.uploadImage({
    folder: "food",
    contentType: file.contentType,
    data: file.data,
  });

  // The retired key is used only after the transaction has committed; a
  // rollback must leave the old file alone.
  let retiredKey: string | null = null;
  let result: SaveFoodPhotoResult;
  try {
    result = await deps.store.transaction(async (tx): Promise<SaveFoodPhotoResult> => {
      // Re-check under the lock: the donation may have been posted or discarded since the read.
      const locked = await tx.getDonationLocked(donationId);
      if (!locked || locked.donorId !== donorId || locked.deletedAt !== null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (locked.status !== DonationStatus.DRAFT) {
        return { ok: false, error: "NOT_EDITABLE" };
      }
      // Re-check under the lock: a review can have been opened since the read.
      if (await tx.hasPendingReview(donationId)) {
        return { ok: false, error: "REVIEW_PENDING" };
      }
      // The screening insert takes this lock too, so a decided screening for
      // the active photo cannot appear between this check and the insert.
      if (await tx.hasDecidedScreeningForActivePhoto(donationId)) {
        return { ok: false, error: "NOT_EDITABLE" };
      }

      // The unique partial index donation_images_one_food_photo_uq allows one
      // active FOOD_PHOTO per donation, so a retake retires the old row first.
      retiredKey = await tx.softDeleteActiveFoodPhoto(donationId);
      const image = await tx.insertFoodPhoto({
        donationId,
        uploadedByUserId: donorId,
        storageKey: key,
        mimeType: file.contentType,
        sizeBytes: file.data.byteLength,
      });
      return { ok: true, imageId: image.id };
    });
  } catch (error) {
    await removePhoto(deps.storage, key, "saveFoodPhoto: failed to remove the uploaded photo");
    throw error;
  }

  if (!result.ok) {
    await removePhoto(deps.storage, key, "saveFoodPhoto: failed to remove the uploaded photo");
    return result;
  }
  // Commit first, delete second: only now is the replaced file safe to remove.
  if (retiredKey !== null) {
    await removePhoto(deps.storage, retiredKey, "saveFoodPhoto: failed to remove the retired photo");
  }
  return result;
}

/**
 * A short-lived link to the donor's own food photo. No status restriction: a
 * donor can look at the photo of any of their own non-deleted donations.
 */
export async function getFoodPhotoUrl(
  deps: { store: PhotoStore; storage: PhotoUrlStorage },
  args: { donorId: string; donationId: string },
): Promise<GetFoodPhotoUrlResult> {
  const { donorId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  // Another donor's donation and a discarded one are the same NOT_FOUND.
  if (!donation || donation.donorId !== donorId || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const photo = await deps.store.findActiveFoodPhoto(donationId);
  if (!photo) return { ok: false, error: "NOT_FOUND" };

  // The key never leaves this function; only the signed URL does.
  const url = await deps.storage.getSignedUrl(photo.storageKey, DEFAULT_SIGNED_URL_SECONDS);
  return {
    ok: true,
    url,
    expiresInSeconds: DEFAULT_SIGNED_URL_SECONDS,
    mimeType: photo.mimeType,
  };
}
