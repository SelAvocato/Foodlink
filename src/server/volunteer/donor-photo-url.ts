import { DonationStatus } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import { DEFAULT_SIGNED_URL_SECONDS, type Storage } from "@/lib/storage";

export type DonorPhotoDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

/** The donor's active FOOD_PHOTO. The storage key stays inside this module. */
export type DonorPhoto = {
  storageKey: string;
  mimeType: AllowedImageType;
};

export interface DonorPhotoUrlStore {
  readDonation(id: string): Promise<DonorPhotoDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  findActiveFoodPhoto(donationId: string): Promise<DonorPhoto | null>;
}

export type DonorPhotoUrlResult =
  | { ok: true; url: string; expiresInSeconds: number; mimeType: AllowedImageType }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" };

/**
 * A short-lived link to the donor's food photo, for the volunteer currently
 * assigned to the donation. The volunteer uses it to compare the food with the
 * donor's description. The key never leaves this function.
 */
export async function getDonorPhotoUrl(
  deps: { store: DonorPhotoUrlStore; storage: Pick<Storage, "getSignedUrl"> },
  args: { volunteerId: string; donationId: string },
): Promise<DonorPhotoUrlResult> {
  const { volunteerId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // Assignment before the status: a volunteer who is not on this donation must
  // not learn its state from the error.
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const photo = await deps.store.findActiveFoodPhoto(donationId);
  if (!photo) return { ok: false, error: "NOT_FOUND" };

  const url = await deps.storage.getSignedUrl(photo.storageKey, DEFAULT_SIGNED_URL_SECONDS);
  return {
    ok: true,
    url,
    expiresInSeconds: DEFAULT_SIGNED_URL_SECONDS,
    mimeType: photo.mimeType,
  };
}
