import { DonationStatus } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import type { Storage } from "@/lib/storage";
import { removePhoto } from "@/server/photos/donation-photo";

/** The donation facts a handover photo needs. */
export type HandoverPhotoDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

export type HandoverPhotoInsert = {
  donationId: string;
  uploadedByUserId: string;
  storageKey: string;
  mimeType: AllowedImageType;
  sizeBytes: number;
};

/**
 * The locked part of the store. The donation row is held FOR UPDATE, so the
 * re-checks and the photo swap cannot interleave with a transition or a second
 * upload.
 */
export type HandoverPhotoTx = {
  getDonationLocked(id: string): Promise<HandoverPhotoDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /** Soft-deletes the active HANDOVER_PROOF rows and returns their storage keys. */
  softDeleteActiveHandoverPhoto(donationId: string): Promise<string[]>;
  insertHandoverPhoto(row: HandoverPhotoInsert): Promise<{ id: string; createdAt: Date }>;
};

export interface HandoverPhotoStore {
  readDonation(id: string): Promise<HandoverPhotoDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /** Runs `work` atomically with the donation locked; rolls back if `work` throws. */
  transaction<T>(work: (tx: HandoverPhotoTx) => Promise<T>): Promise<T>;
}

export type HandoverPhotoStorage = Pick<Storage, "uploadImage" | "removeObject">;

export type HandoverPhotoError = "NOT_FOUND" | "INVALID_STATE";

export type SaveHandoverPhotoResult =
  | { ok: true; uploadedAt: Date }
  | { ok: false; error: HandoverPhotoError };

const ALLOWED_STATUSES: readonly DonationStatus[] = [
  DonationStatus.PICKED_UP,
  DonationStatus.DELIVERED,
];

/**
 * Uploads the proof photo of the drop-off. It is a record, not a safety gate:
 * no AI screening runs on it, and uploading it neither requires nor performs the
 * drop-off scan. It may be retaken while the donation is PICKED_UP or DELIVERED
 * (the previous active HANDOVER_PROOF is retired); donations.status is never
 * written here.
 */
export async function saveHandoverPhoto(
  deps: { store: HandoverPhotoStore; storage: HandoverPhotoStorage },
  args: {
    volunteerId: string;
    donationId: string;
    file: { contentType: AllowedImageType; data: Uint8Array };
  },
): Promise<SaveHandoverPhotoResult> {
  const { volunteerId, donationId, file } = args;

  // A plain read first: a foreign or finished donation must never cause an upload.
  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (!ALLOWED_STATUSES.includes(donation.status)) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const { key } = await deps.storage.uploadImage({
    folder: "handover",
    contentType: file.contentType,
    data: file.data,
  });

  // The retired keys are used only after the transaction has committed; a
  // rollback must leave the old files alone.
  let retiredKeys: string[] = [];
  let result: SaveHandoverPhotoResult;
  try {
    result = await deps.store.transaction(async (tx): Promise<SaveHandoverPhotoResult> => {
      // Re-check under the lock: the donation may have moved on since the read.
      const locked = await tx.getDonationLocked(donationId);
      if (!locked || locked.deletedAt !== null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if ((await tx.findCurrentVolunteerId(donationId)) !== volunteerId) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (!ALLOWED_STATUSES.includes(locked.status)) {
        return { ok: false, error: "INVALID_STATE" };
      }

      // A retake replaces the volunteer's proof; the old row is retired so
      // there is one active HANDOVER_PROOF, like the donor's FOOD_PHOTO.
      retiredKeys = await tx.softDeleteActiveHandoverPhoto(donationId);
      const image = await tx.insertHandoverPhoto({
        donationId,
        uploadedByUserId: volunteerId,
        storageKey: key,
        mimeType: file.contentType,
        sizeBytes: file.data.byteLength,
      });
      return { ok: true, uploadedAt: image.createdAt };
    });
  } catch (error) {
    await removePhoto(deps.storage, key, "saveHandoverPhoto: failed to remove the uploaded photo");
    throw error;
  }

  if (!result.ok) {
    await removePhoto(deps.storage, key, "saveHandoverPhoto: failed to remove the uploaded photo");
    return result;
  }
  // Commit first, delete second: only now are the replaced files safe to remove.
  for (const retiredKey of retiredKeys) {
    await removePhoto(deps.storage, retiredKey, "saveHandoverPhoto: failed to remove the retired photo");
  }
  return result;
}
