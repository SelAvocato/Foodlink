import { describe, expect, it } from "vitest";
import { PLACEHOLDER_FOOD_NAME } from "./photo-step-logic";
import {
  deriveResumeStep,
  findResumableDraft,
  lookupDraft,
  parseChecklistComplete,
  parseDraftParam,
  parsePhotoUrl,
  parsePickupSaved,
} from "./resume-logic";

const DRAFT_ID = "9fc03951-1111-4111-8111-111111111111";
const OTHER_ID = "2b7f6f0e-2222-4222-9222-222222222222";

/** The list entry as GET /api/donor/drafts really sends it, dates as ISO strings. */
function draftEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DRAFT_ID,
    foodName: "Chicken adobo",
    description: null,
    portions: 25,
    status: "DRAFT",
    foodCategoryCode: "COOKED_MEALS",
    allergenCodes: ["PEANUTS"],
    dietaryTagCodes: ["HALAL"],
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseDraftParam", () => {
  it("returns a single uuid param", () => {
    expect(parseDraftParam(DRAFT_ID)).toBe(DRAFT_ID);
  });

  it("returns null when the param is absent", () => {
    expect(parseDraftParam(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseDraftParam("")).toBeNull();
  });

  it("returns null for a non-uuid value", () => {
    expect(parseDraftParam("draft-1")).toBeNull();
    expect(parseDraftParam("9fc03951-1111-4111-8111")).toBeNull();
  });

  it("returns null for an array, even one holding a single uuid", () => {
    expect(parseDraftParam([DRAFT_ID])).toBeNull();
    expect(parseDraftParam([DRAFT_ID, OTHER_ID])).toBeNull();
  });
});

describe("findResumableDraft", () => {
  it("returns the matching DRAFT entry with only the resume fields", () => {
    const body = { drafts: [draftEntry({ id: OTHER_ID }), draftEntry()] };

    expect(findResumableDraft(body, DRAFT_ID)).toEqual({
      id: DRAFT_ID,
      foodName: "Chicken adobo",
      status: "DRAFT",
      foodCategoryCode: "COOKED_MEALS",
    });
  });

  it("returns the matching SCREENED entry", () => {
    const body = { drafts: [draftEntry({ status: "SCREENED" })] };

    expect(findResumableDraft(body, DRAFT_ID)).toEqual({
      id: DRAFT_ID,
      foodName: "Chicken adobo",
      status: "SCREENED",
      foodCategoryCode: "COOKED_MEALS",
    });
  });

  it("returns null when no entry has that id", () => {
    expect(findResumableDraft({ drafts: [draftEntry({ id: OTHER_ID })] }, DRAFT_ID)).toBeNull();
    expect(findResumableDraft({ drafts: [] }, DRAFT_ID)).toBeNull();
  });

  it.each(["POSTED", "REJECTED"])("returns null when the matching entry is %s", (status) => {
    const body = { drafts: [draftEntry({ status })] };

    expect(findResumableDraft(body, DRAFT_ID)).toBeNull();
  });

  it("returns null for a malformed body", () => {
    expect(findResumableDraft(null, DRAFT_ID)).toBeNull();
    expect(findResumableDraft({}, DRAFT_ID)).toBeNull();
    expect(findResumableDraft({ drafts: "not a list" }, DRAFT_ID)).toBeNull();
    // An entry missing the documented fields makes the whole body unreadable.
    expect(findResumableDraft({ drafts: [{ id: DRAFT_ID }] }, DRAFT_ID)).toBeNull();
    expect(findResumableDraft({ drafts: [draftEntry({ status: 7 })] }, DRAFT_ID)).toBeNull();
  });

  it("tolerates unknown fields on the body and on the entry", () => {
    const body = {
      drafts: [draftEntry({ donorId: "donor-1", anythingElse: true })],
      counts: { drafts: 1 },
    };

    expect(findResumableDraft(body, DRAFT_ID)).toEqual({
      id: DRAFT_ID,
      foodName: "Chicken adobo",
      status: "DRAFT",
      foodCategoryCode: "COOKED_MEALS",
    });
  });
});

describe("parseChecklistComplete", () => {
  it("reads complete: true from the checklist response", () => {
    const body = {
      checklist: { packagingIntact: true, completedAt: "2026-11-06T00:00:00.000Z" },
      complete: true,
      missing: [],
    };

    expect(parseChecklistComplete(body)).toBe(true);
  });

  it("reads complete: false with the missing fields listed", () => {
    const body = {
      checklist: null,
      complete: false,
      missing: ["consumeByAt", "packagingIntact"],
    };

    expect(parseChecklistComplete(body)).toBe(false);
  });

  it("tolerates unknown fields", () => {
    expect(
      parseChecklistComplete({ checklist: null, complete: false, missing: [], extra: 1 }),
    ).toBe(false);
  });

  it("returns null for a malformed body", () => {
    expect(parseChecklistComplete(null)).toBeNull();
    expect(parseChecklistComplete({})).toBeNull();
    expect(parseChecklistComplete({ checklist: null, complete: "yes", missing: [] })).toBeNull();
    // Not the documented response: the flag alone does not make it readable.
    expect(parseChecklistComplete({ complete: true })).toBeNull();
  });
});

describe("parsePickupSaved", () => {
  it("is true when the pickup is an object", () => {
    const body = {
      pickup: {
        address: { line1: "123 Fake Street", city: "Manila" },
        pickupStart: "2026-11-10T09:00:00.000Z",
        pickupEnd: "2026-11-10T11:00:00.000Z",
      },
    };

    expect(parsePickupSaved(body)).toBe(true);
  });

  it("is false when the pickup is null", () => {
    expect(parsePickupSaved({ pickup: null })).toBe(false);
  });

  it("returns null for a malformed body", () => {
    expect(parsePickupSaved(null)).toBeNull();
    expect(parsePickupSaved({})).toBeNull();
    expect(parsePickupSaved({ pickup: "soon" })).toBeNull();
    expect(parsePickupSaved({ pickup: 3 })).toBeNull();
  });
});

describe("parsePhotoUrl", () => {
  const SIGNED_URL = "https://storage.example.test/food/photo.jpg?token=fake-token";
  const photoBody = {
    url: SIGNED_URL,
    expiresInSeconds: 300,
    mimeType: "image/jpeg",
  };

  it("returns the url of the photo response", () => {
    expect(parsePhotoUrl(photoBody)).toBe(SIGNED_URL);
  });

  it("tolerates unknown fields", () => {
    expect(parsePhotoUrl({ ...photoBody, storageKey: "food/photo.jpg", extra: true })).toBe(
      SIGNED_URL,
    );
  });

  it("returns null when the url is missing", () => {
    expect(parsePhotoUrl({ expiresInSeconds: 300, mimeType: "image/jpeg" })).toBeNull();
  });

  it("returns null for an empty url", () => {
    expect(parsePhotoUrl({ ...photoBody, url: "" })).toBeNull();
  });

  it("returns null for a non-object body", () => {
    expect(parsePhotoUrl(null)).toBeNull();
    expect(parsePhotoUrl(SIGNED_URL)).toBeNull();
    expect(parsePhotoUrl(42)).toBeNull();
  });

  it("returns null when a sibling field is missing or the wrong type", () => {
    expect(parsePhotoUrl({ url: SIGNED_URL })).toBeNull();
    expect(parsePhotoUrl({ ...photoBody, expiresInSeconds: "300" })).toBeNull();
  });
});

describe("deriveResumeStep", () => {
  const finished = {
    foodName: "Chicken adobo",
    checklistComplete: true,
    pickupSaved: true,
  };

  it("sends a DRAFT to photo whatever else is true", () => {
    expect(deriveResumeStep({ status: "DRAFT", ...finished })).toBe("photo");
    expect(
      deriveResumeStep({
        status: "DRAFT",
        foodName: PLACEHOLDER_FOOD_NAME,
        checklistComplete: false,
        pickupSaved: false,
      }),
    ).toBe("photo");
  });

  it("sends a SCREENED draft to checklist until the checklist is complete", () => {
    expect(deriveResumeStep({ status: "SCREENED", ...finished, checklistComplete: false })).toBe(
      "checklist",
    );
  });

  it("sends a SCREENED draft with the placeholder name to details", () => {
    expect(
      deriveResumeStep({ status: "SCREENED", ...finished, foodName: PLACEHOLDER_FOOD_NAME }),
    ).toBe("details");
  });

  it("sends a SCREENED draft without a pickup window to details", () => {
    expect(deriveResumeStep({ status: "SCREENED", ...finished, pickupSaved: false })).toBe(
      "details",
    );
  });

  it("sends a SCREENED draft with both gaps to details", () => {
    expect(
      deriveResumeStep({
        status: "SCREENED",
        foodName: PLACEHOLDER_FOOD_NAME,
        checklistComplete: true,
        pickupSaved: false,
      }),
    ).toBe("details");
  });

  it("sends a finished SCREENED draft to review", () => {
    expect(deriveResumeStep({ status: "SCREENED", ...finished })).toBe("review");
  });
});

describe("lookupDraft", () => {
  it("finds a DRAFT entry", () => {
    const result = lookupDraft({ drafts: [draftEntry()] }, DRAFT_ID);

    expect(result).toEqual({
      kind: "found",
      draft: {
        id: DRAFT_ID,
        foodName: "Chicken adobo",
        status: "DRAFT",
        foodCategoryCode: "COOKED_MEALS",
      },
    });
  });

  it("finds a SCREENED entry", () => {
    const result = lookupDraft({ drafts: [draftEntry({ status: "SCREENED" })] }, DRAFT_ID);

    expect(result.kind).toBe("found");
  });

  it("is missing when no entry has that id", () => {
    expect(lookupDraft({ drafts: [draftEntry({ id: OTHER_ID })] }, DRAFT_ID)).toEqual({
      kind: "missing",
    });
    expect(lookupDraft({ drafts: [] }, DRAFT_ID)).toEqual({ kind: "missing" });
  });

  it("is missing when the matching entry has a status the wizard cannot resume", () => {
    expect(lookupDraft({ drafts: [draftEntry({ status: "POSTED" })] }, DRAFT_ID)).toEqual({
      kind: "missing",
    });
  });

  it.each([null, undefined, "drafts", 42, {}, { drafts: "nope" }])(
    "fails for a body that is not the list shape (%s)",
    (body) => {
      expect(lookupDraft(body, DRAFT_ID)).toEqual({ kind: "failed" });
    },
  );

  it("fails when the matching entry is malformed, so the donor can retry", () => {
    expect(lookupDraft({ drafts: [{ id: DRAFT_ID }] }, DRAFT_ID)).toEqual({ kind: "failed" });
  });

  it("ignores malformed entries that are not the wanted one", () => {
    const body = { drafts: [null, "junk", { id: OTHER_ID }, draftEntry()] };

    expect(lookupDraft(body, DRAFT_ID).kind).toBe("found");
  });
});
