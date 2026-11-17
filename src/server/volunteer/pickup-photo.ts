import { DonationStatus, type ScreeningVerdict } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import type { Storage } from "@/lib/storage";
import { removePhoto } from "@/server/photos/donation-photo";
import {
  DEFAULT_TIMEOUT_MS,
  callProvider,
  evaluateAttempt,
  type ScreeningInsert,
} from "@/server/screening/screen-draft-photo";
import type { ScreeningProvider } from "@/server/screening/screening-provider";

/** The donation facts a pickup photo needs. */
export type PickupPhotoDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

export type PickupPhotoInsert = {
  donationId: string;
  uploadedByUserId: string;
  storageKey: string;
  mimeType: AllowedImageType;
  sizeBytes: number;
};

/**
 * The locked part of the store. The donation row is held FOR UPDATE, so the
 * re-checks, the photo swap and the screening insert cannot interleave with a
 * transition or a second upload.
 */
export type PickupPhotoTx = {
  getDonationLocked(id: string): Promise<PickupPhotoDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /** The volunteer's own PICKUP scan; another volunteer's scan does not count. */
  hasPickupScan(donationId: string, volunteerId: string): Promise<boolean>;
  hasInspection(donationId: string): Promise<boolean>;
  /** Soft-deletes the active PICKUP_PHOTO rows and returns their storage keys. */
  softDeleteActivePickupPhoto(donationId: string): Promise<string[]>;
  insertPickupPhoto(row: PickupPhotoInsert): Promise<{ id: string }>;
  insertScreening(row: ScreeningInsert): Promise<{ id: string }>;
};

export interface PickupPhotoStore {
  readDonation(id: string): Promise<PickupPhotoDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  hasPickupScan(donationId: string, volunteerId: string): Promise<boolean>;
  hasInspection(donationId: string): Promise<boolean>;
  /** Runs `work` atomically with the donation locked; rolls back if `work` throws. */
  transaction<T>(work: (tx: PickupPhotoTx) => Promise<T>): Promise<T>;
}

export type PickupPhotoStorage = Pick<Storage, "uploadImage" | "getSignedUrl" | "removeObject">;

export type SavePickupPhotoDeps = {
  store: PickupPhotoStore;
  storage: PickupPhotoStorage;
  provider: ScreeningProvider;
  /** Defaults to DEFAULT_TIMEOUT_MS; tests pass a small value. */
  timeoutMs?: number;
};

export type PickupPhotoError = "NOT_FOUND" | "INVALID_STATE" | "SCAN_REQUIRED";

export type SavePickupPhotoResult =
  | { ok: true; verdict: ScreeningVerdict; screeningId: string }
  | { ok: false; error: PickupPhotoError };

/** One minute is enough for the provider to download the image. */
const SIGNED_URL_SECONDS = 60;

/**
 * Uploads the volunteer's pickup photo, screens it and stores the verdict. The
 * PICKUP scan is a precondition: a volunteer who has not scanned the label
 * cannot skip the check by photographing the food. The photo may be retaken
 * (the previous active PICKUP_PHOTO is retired) until an inspection has been
 * saved, because the inspection is recorded against the photo it was made for.
 * donations.status is never written here.
 */
export async function savePickupPhoto(
  deps: SavePickupPhotoDeps,
  args: { volunteerId: string; donationId: string; file: { contentType: AllowedImageType; data: Uint8Array } },
): Promise<SavePickupPhotoResult> {
  const { volunteerId, donationId, file } = args;

  // A plain read first: a foreign, finished or uninspected donation must never
  // cause an upload.
  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (!(await deps.store.hasPickupScan(donationId, volunteerId))) {
    return { ok: false, error: "SCAN_REQUIRED" };
  }
  if (await deps.store.hasInspection(donationId)) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const { key } = await deps.storage.uploadImage({
    folder: "pickup",
    contentType: file.contentType,
    data: file.data,
  });

  // The retired keys are used only after the transaction has committed; a
  // rollback must leave the old files alone.
  let retiredKeys: string[] = [];
  let result: SavePickupPhotoResult;
  try {
    // Only the short-lived URL reaches the provider; the key never leaves the server.
    const imageUrl = await deps.storage.getSignedUrl(key, SIGNED_URL_SECONDS);
    const attempt = await callProvider(
      deps.provider,
      { imageUrl, mimeType: file.contentType },
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const evaluation = evaluateAttempt(attempt);

    result = await deps.store.transaction(async (tx): Promise<SavePickupPhotoResult> => {
      // Re-check under the lock: the donation may have moved on since the read.
      const locked = await tx.getDonationLocked(donationId);
      if (!locked || locked.deletedAt !== null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if ((await tx.findCurrentVolunteerId(donationId)) !== volunteerId) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (locked.status !== DonationStatus.ASSIGNED) {
        return { ok: false, error: "INVALID_STATE" };
      }
      if (!(await tx.hasPickupScan(donationId, volunteerId))) {
        return { ok: false, error: "SCAN_REQUIRED" };
      }
      if (await tx.hasInspection(donationId)) {
        return { ok: false, error: "INVALID_STATE" };
      }

      // A retake replaces the volunteer's photo; the old row is retired so
      // there is one active PICKUP_PHOTO, like the donor's FOOD_PHOTO.
      retiredKeys = await tx.softDeleteActivePickupPhoto(donationId);
      const image = await tx.insertPickupPhoto({
        donationId,
        uploadedByUserId: volunteerId,
        storageKey: key,
        mimeType: file.contentType,
        sizeBytes: file.data.byteLength,
      });
      const screening = await tx.insertScreening({
        donationId,
        imageId: image.id,
        provider: deps.provider.name,
        modelVersion: deps.provider.modelVersion,
        verdict: evaluation.verdict,
        confidence: evaluation.confidence,
        signs: evaluation.signs,
        notes: evaluation.notes,
      });
      return { ok: true, verdict: evaluation.verdict, screeningId: screening.id };
    });
  } catch (error) {
    await removePhoto(deps.storage, key, "savePickupPhoto: failed to remove the uploaded photo");
    throw error;
  }

  if (!result.ok) {
    await removePhoto(deps.storage, key, "savePickupPhoto: failed to remove the uploaded photo");
    return result;
  }
  // Commit first, delete second: only now are the replaced files safe to remove.
  for (const retiredKey of retiredKeys) {
    await removePhoto(deps.storage, retiredKey, "savePickupPhoto: failed to remove the retired photo");
  }
  return result;
}
