import type { ScreeningVerdict } from "./enums";
import { MAX_IMAGE_BYTES } from "./image";

/** Vercel rejects bodies over 4.5 MB before the handler runs, so the cap matches the donor photo. */
export const MAX_PICKUP_PHOTO_BYTES = Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024);
export const PICKUP_PHOTO_MESSAGE = "Photo must be a JPEG, PNG, or WebP image up to 4 MB.";

/** The screening result only. The decision belongs to the inspection step and the key never leaves the server. */
export type VolunteerPickupPhotoResponse = {
  verdict: ScreeningVerdict;
  screeningId: string;
};
