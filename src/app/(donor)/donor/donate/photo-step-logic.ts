import { z } from "zod";

/** Step 1 seeds the draft with these until step 3 collects the real food name and portions. */
export const PLACEHOLDER_FOOD_NAME = "Untitled donation";
export const PLACEHOLDER_PORTIONS = 1;

/** Same limit as the photo route: Vercel rejects bodies over 4.5 MB before the route runs. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type PhotoValidationCode = "UNSUPPORTED_TYPE" | "TOO_LARGE";

export type PhotoValidationResult =
  | { ok: true }
  | { ok: false; error: PhotoValidationCode };

/** Client-side pre-check before any request; the server enforces both again on the bytes. */
export function validatePhotoFile(file: { type: string; size: number }): PhotoValidationResult {
  if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { ok: false, error: "UNSUPPORTED_TYPE" };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }
  return { ok: true };
}

export function photoValidationMessage(code: PhotoValidationCode): string {
  return code === "TOO_LARGE"
    ? "Choose an image up to 4 MB."
    : "Choose a JPEG, PNG, or WebP image.";
}

/** Shown when a request fails for a reason the step has no words for. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * Mapped from the error codes the draft, photo and screening routes really
 * return (plus the auth codes); the server's message text is never rendered.
 */
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "That request was not valid. Please try again.",
  DONOR_NOT_ACTIVE: "Your donor account is not active.",
  UNKNOWN_CATEGORY: "That food category does not exist.",
  UNKNOWN_ALLERGEN: "One or more allergen codes are unknown.",
  UNKNOWN_DIETARY_TAG: "One or more dietary tag codes are unknown.",
  CATEGORY_NOT_ALLOWED: "That food category is not allowed for your account.",
  NOT_FOUND: "The draft was not found.",
  NOT_EDITABLE: "That draft can no longer be changed.",
  REVIEW_PENDING: "Your photo is waiting for review.",
  PHOTO_REQUIRED: "Upload a photo before screening.",
  PHOTO_CHANGED: "The photo changed during screening. Try again.",
  INTERNAL_ERROR: GENERIC_ERROR,
  UNAUTHENTICATED: "You are not signed in.",
  INACTIVE_ACCOUNT: "Your account is not active.",
  FORBIDDEN: "You do not have access to this action.",
};

export function messageForError(code: string | undefined): string {
  if (code === undefined) return GENERIC_ERROR;
  return Object.hasOwn(ERROR_MESSAGES, code) ? ERROR_MESSAGES[code] : GENERIC_ERROR;
}

/**
 * The photo route answers INVALID_REQUEST for a file whose bytes are not a
 * real JPEG, PNG or WebP (or are empty), so on the upload that code names the
 * photo; every other code keeps its usual message.
 */
export function photoUploadMessage(code: string | undefined): string {
  if (code === "INVALID_REQUEST") return "Choose a JPEG, PNG, or WebP image up to 4 MB.";
  return messageForError(code);
}

/** The `error` field of the routes' `{ error, message }` body, or undefined. */
export function errorCodeFrom(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : undefined;
}

/** The `donationId` of the draft creation response, or null when it is not there. */
export function donationIdFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { donationId?: unknown }).donationId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

const screeningResponseSchema = z.strictObject({
  donationId: z.string(),
  verdict: z.enum(["PASS", "FLAG", "REVIEW"]),
  donationStatus: z.enum(["SCREENED", "REJECTED", "DRAFT"]),
  reason: z.string().min(1).optional(),
});

export type ScreeningOutcome =
  | { outcome: "passed" }
  | { outcome: "flagged"; reason: string }
  | { outcome: "review" };

/**
 * The screening route's success body mapped to what the step shows. A verdict
 * that disagrees with the donation status (or a FLAG without a reason) is
 * treated as malformed: null, so the step shows the generic error instead of
 * guessing. The FLAG reason is server text shown as plain text, never markup.
 */
export function screeningOutcome(response: unknown): ScreeningOutcome | null {
  const parsed = screeningResponseSchema.safeParse(response);
  if (!parsed.success) return null;
  const { verdict, donationStatus, reason } = parsed.data;
  if (verdict === "PASS" && donationStatus === "SCREENED") {
    return { outcome: "passed" };
  }
  if (verdict === "FLAG" && donationStatus === "REJECTED") {
    return reason === undefined ? null : { outcome: "flagged", reason };
  }
  if (verdict === "REVIEW" && donationStatus === "DRAFT") {
    return { outcome: "review" };
  }
  return null;
}

export type ScreenPhotoReadiness = {
  hasCategory: boolean;
  hasPhoto: boolean;
  busy: boolean;
  waitingForReview: boolean;
};

/** The Screen photo button is enabled only when every condition holds. */
export function canScreenPhoto(state: ScreenPhotoReadiness): boolean {
  return state.hasCategory && state.hasPhoto && !state.busy && !state.waitingForReview;
}
