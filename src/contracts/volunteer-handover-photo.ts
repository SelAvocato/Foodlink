import { MAX_IMAGE_BYTES } from "./image";

/** Vercel rejects bodies over 4.5 MB before the handler runs, so the cap matches the other photos. */
export const MAX_HANDOVER_PHOTO_BYTES = Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024);
export const HANDOVER_PHOTO_MESSAGE = "Photo must be a JPEG, PNG, or WebP image up to 4 MB.";

/**
 * The proof photo is stored as-is: it is a record of the drop-off, not a safety
 * gate, so it is not sent to the AI screening provider and no decision follows.
 */
export type VolunteerHandoverPhotoResponse = {
  uploaded: true;
};
