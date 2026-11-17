import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR,
  MAX_PHOTO_BYTES,
  PLACEHOLDER_FOOD_NAME,
  PLACEHOLDER_PORTIONS,
  canScreenPhoto,
  donationIdFrom,
  errorCodeFrom,
  messageForError,
  photoUploadMessage,
  photoValidationMessage,
  screeningOutcome,
  validatePhotoFile,
} from "./photo-step-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";

function passResponse(): Record<string, unknown> {
  return { donationId: DONATION_ID, verdict: "PASS", donationStatus: "SCREENED" };
}

describe("placeholder constants", () => {
  it("seeds the draft with the agreed placeholder values", () => {
    expect(PLACEHOLDER_FOOD_NAME).toBe("Untitled donation");
    expect(PLACEHOLDER_PORTIONS).toBe(1);
  });
});

describe("validatePhotoFile", () => {
  it("accepts JPEG, PNG and WebP", () => {
    expect(validatePhotoFile({ type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
    expect(validatePhotoFile({ type: "image/png", size: 1024 })).toEqual({ ok: true });
    expect(validatePhotoFile({ type: "image/webp", size: 1024 })).toEqual({ ok: true });
  });

  it("refuses gif and pdf", () => {
    expect(validatePhotoFile({ type: "image/gif", size: 1024 })).toEqual({
      ok: false,
      error: "UNSUPPORTED_TYPE",
    });
    expect(validatePhotoFile({ type: "application/pdf", size: 1024 })).toEqual({
      ok: false,
      error: "UNSUPPORTED_TYPE",
    });
  });

  it("accepts exactly 4 MB and refuses one byte more", () => {
    expect(validatePhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES })).toEqual({ ok: true });
    expect(MAX_PHOTO_BYTES).toBe(4 * 1024 * 1024);
    expect(
      validatePhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 }),
    ).toEqual({ ok: false, error: "TOO_LARGE" });
  });

  it("checks the type before the size", () => {
    expect(validatePhotoFile({ type: "image/gif", size: MAX_PHOTO_BYTES + 1 })).toEqual({
      ok: false,
      error: "UNSUPPORTED_TYPE",
    });
  });

  it("has a message for each refusal code", () => {
    expect(photoValidationMessage("UNSUPPORTED_TYPE")).toBe("Choose a JPEG, PNG, or WebP image.");
    expect(photoValidationMessage("TOO_LARGE")).toBe("Choose an image up to 4 MB.");
  });
});

describe("messageForError", () => {
  it.each([
    ["INVALID_REQUEST", "That request was not valid. Please try again."],
    ["DONOR_NOT_ACTIVE", "Your donor account is not active."],
    ["UNKNOWN_CATEGORY", "That food category does not exist."],
    ["UNKNOWN_ALLERGEN", "One or more allergen codes are unknown."],
    ["UNKNOWN_DIETARY_TAG", "One or more dietary tag codes are unknown."],
    ["CATEGORY_NOT_ALLOWED", "That food category is not allowed for your account."],
    ["NOT_FOUND", "The draft was not found."],
    ["NOT_EDITABLE", "That draft can no longer be changed."],
    ["REVIEW_PENDING", "Your photo is waiting for review."],
    ["PHOTO_REQUIRED", "Upload a photo before screening."],
    ["PHOTO_CHANGED", "The photo changed during screening. Try again."],
    ["INTERNAL_ERROR", GENERIC_ERROR],
    ["UNAUTHENTICATED", "You are not signed in."],
    ["INACTIVE_ACCOUNT", "Your account is not active."],
    ["FORBIDDEN", "You do not have access to this action."],
  ])("maps %s to its message", (code, message) => {
    expect(messageForError(code)).toBe(message);
  });

  it("falls back for an unknown code", () => {
    expect(messageForError("SOMETHING_NEW")).toBe(GENERIC_ERROR);
  });

  it("falls back when there is no code", () => {
    expect(messageForError(undefined)).toBe(GENERIC_ERROR);
  });
});

describe("photoUploadMessage", () => {
  it("names the photo when the upload route refuses the file", () => {
    expect(photoUploadMessage("INVALID_REQUEST")).toBe(
      "Choose a JPEG, PNG, or WebP image up to 4 MB.",
    );
  });

  it("keeps the usual message for the other codes", () => {
    expect(photoUploadMessage("REVIEW_PENDING")).toBe(messageForError("REVIEW_PENDING"));
    expect(photoUploadMessage("NOT_FOUND")).toBe(messageForError("NOT_FOUND"));
  });

  it("falls back for an unknown code and for no code", () => {
    expect(photoUploadMessage("SOMETHING_NEW")).toBe(GENERIC_ERROR);
    expect(photoUploadMessage(undefined)).toBe(GENERIC_ERROR);
  });
});

describe("errorCodeFrom", () => {
  it("reads the error field of the routes' body", () => {
    expect(errorCodeFrom({ error: "NOT_FOUND", message: "server text" })).toBe("NOT_FOUND");
  });

  it("returns undefined for anything that is not that body", () => {
    expect(errorCodeFrom(null)).toBeUndefined();
    expect(errorCodeFrom({ message: "no code" })).toBeUndefined();
    expect(errorCodeFrom({ error: 500 })).toBeUndefined();
  });
});

describe("donationIdFrom", () => {
  it("reads the donationId of the draft creation response", () => {
    expect(donationIdFrom({ donationId: DONATION_ID })).toBe(DONATION_ID);
  });

  it("returns null when the id is missing or empty", () => {
    expect(donationIdFrom({})).toBeNull();
    expect(donationIdFrom({ donationId: "" })).toBeNull();
    expect(donationIdFrom(null)).toBeNull();
  });
});

describe("screeningOutcome", () => {
  it("maps PASS with SCREENED to passed", () => {
    expect(screeningOutcome(passResponse())).toEqual({ outcome: "passed" });
  });

  it("maps FLAG with REJECTED to flagged and carries the reason", () => {
    const reason = "Photo failed visual screening: Too dim.";
    expect(
      screeningOutcome({
        donationId: DONATION_ID,
        verdict: "FLAG",
        donationStatus: "REJECTED",
        reason,
      }),
    ).toEqual({ outcome: "flagged", reason });
  });

  it("maps REVIEW exactly as the service returns it to review", () => {
    expect(
      screeningOutcome({ donationId: DONATION_ID, verdict: "REVIEW", donationStatus: "DRAFT" }),
    ).toEqual({ outcome: "review" });
  });

  it("returns null for a malformed response", () => {
    expect(screeningOutcome(null)).toBeNull();
    expect(screeningOutcome({})).toBeNull();
    expect(screeningOutcome({ donationId: DONATION_ID, verdict: "PASS" })).toBeNull();
    // Verdict and donation status must agree.
    expect(screeningOutcome({ ...passResponse(), donationStatus: "DRAFT" })).toBeNull();
    // A FLAG without a reason cannot be shown.
    expect(
      screeningOutcome({ donationId: DONATION_ID, verdict: "FLAG", donationStatus: "REJECTED" }),
    ).toBeNull();
    // Strict: unknown fields are a shape drift, not something to render.
    expect(screeningOutcome({ ...passResponse(), extra: true })).toBeNull();
  });
});

describe("canScreenPhoto", () => {
  const ready = { hasCategory: true, hasPhoto: true, busy: false, waitingForReview: false };

  it("is true when every condition holds", () => {
    expect(canScreenPhoto(ready)).toBe(true);
  });

  it("is false without a category", () => {
    expect(canScreenPhoto({ ...ready, hasCategory: false })).toBe(false);
  });

  it("is false without a photo", () => {
    expect(canScreenPhoto({ ...ready, hasPhoto: false })).toBe(false);
  });

  it("is false while a request is running", () => {
    expect(canScreenPhoto({ ...ready, busy: true })).toBe(false);
  });

  it("is false while waiting for review", () => {
    expect(canScreenPhoto({ ...ready, waitingForReview: true })).toBe(false);
  });
});
