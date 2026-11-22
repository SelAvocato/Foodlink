import { describe, expect, it } from "vitest";
import { PickupDecision, ScreeningVerdict, StorageCondition } from "@/contracts/enums";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";
import {
  CHECKLIST_ERROR,
  CHECKLIST_LOADING,
  MAX_PHOTO_BYTES,
  REJECT_REASONS,
  canAcceptPickup,
  canConfirmRejection,
  canRejectPickup,
  canScreenStaged,
  checkPhotoFile,
  checkQuestions,
  combineReason,
  donorChecklistLine,
  errorCode,
  errorMessage,
  formatTime,
  inspectionBody,
  outcomePanel,
  parseChecklist,
  parseOutcomeDecision,
  parsePhotoResponse,
  parseTaskDetail,
  screeningPanel,
  type ChecklistState,
  type TaskDetail,
} from "./pickup-inspection-logic";

// Every date is built with the local constructor so the test never depends on a fixed zone.
const NOW = new Date(2026, 10, 21, 12, 0);

function checklist(overrides: Partial<VolunteerChecklistResponse> = {}): VolunteerChecklistResponse {
  return {
    preparedAt: null,
    consumeByAt: null,
    storageCondition: null,
    storageTemperatureC: null,
    packagingIntact: null,
    allergensConfirmed: null,
    notCustomerPlateLeftovers: null,
    allergens: [],
    ...overrides,
  };
}

function ready(overrides: Partial<VolunteerChecklistResponse> = {}): ChecklistState {
  return { kind: "ready", checklist: checklist(overrides) };
}

describe("donorChecklistLine", () => {
  it("joins every part in order", () => {
    const line = donorChecklistLine(
      ready({
        preparedAt: new Date(2026, 10, 21, 9, 0).toISOString(),
        consumeByAt: new Date(2026, 10, 21, 18, 0).toISOString(),
        storageCondition: StorageCondition.HOT_HELD,
        storageTemperatureC: 63,
        packagingIntact: true,
        allergensConfirmed: true,
        notCustomerPlateLeftovers: true,
        allergens: ["Soy", "Milk"],
      }),
      NOW,
    );
    expect(line).toBe(
      "Donor checklist: Prepared 9:00 AM · Consume by 6:00 PM · Hot-held at 63°C · Soy, Milk declared · Packaging clean · Not opened or leftover",
    );
  });

  it("keeps only the parts the data allows and dates a later consume-by", () => {
    const line = donorChecklistLine(
      ready({
        consumeByAt: new Date(2026, 10, 22, 18, 0).toISOString(),
        storageTemperatureC: 4.5,
        allergensConfirmed: false,
      }),
      NOW,
    );
    expect(line).toBe("Donor checklist: Consume by Nov 22, 6:00 PM · Stored at 4.5°C");
  });

  it("shows a declared allergen even when every checklist answer is missing", () => {
    expect(donorChecklistLine(ready({ allergens: ["Peanuts"] }), NOW)).toBe(
      "Donor checklist: Peanuts declared",
    );
  });

  it("accepts a response with every checklist field null and a declared allergen", () => {
    expect(
      parseChecklist({
        preparedAt: null,
        consumeByAt: null,
        storageCondition: null,
        storageTemperatureC: null,
        packagingIntact: null,
        allergensConfirmed: null,
        notCustomerPlateLeftovers: null,
        allergens: ["Peanuts"],
      }),
    ).not.toBeNull();
  });

  it("says no allergens were declared when the list is empty and confirmed", () => {
    expect(donorChecklistLine(ready({ allergensConfirmed: true }), NOW)).toBe(
      "Donor checklist: No allergens declared",
    );
  });

  it("stays silent about allergens that were not confirmed", () => {
    expect(donorChecklistLine(ready({ allergensConfirmed: null }), NOW)).toBe(
      "Donor checklist: nothing recorded",
    );
  });

  it("shows the storage label alone when no temperature was saved", () => {
    expect(donorChecklistLine(ready({ storageCondition: StorageCondition.FROZEN }), NOW)).toBe(
      "Donor checklist: Frozen",
    );
  });

  it("reports loading and a failed read", () => {
    expect(donorChecklistLine({ kind: "loading" }, NOW)).toBe(CHECKLIST_LOADING);
    expect(donorChecklistLine({ kind: "error" }, NOW)).toBe(CHECKLIST_ERROR);
  });

  it("formats noon and midnight in the local 12-hour clock", () => {
    expect(formatTime(new Date(2026, 10, 21, 0, 5))).toBe("12:05 AM");
    expect(formatTime(new Date(2026, 10, 21, 12, 5))).toBe("12:05 PM");
  });
});

describe("screeningPanel", () => {
  it("says the photo is not done before any upload", () => {
    expect(screeningPanel(null)).toEqual({
      title: "Photo screening: not done yet",
      body: null,
    });
  });

  it("maps PASS, REVIEW and FLAG", () => {
    expect(screeningPanel(ScreeningVerdict.PASS)).toEqual({
      title: "Photo screening: Pass",
      body: "A visual aid only. Your inspection is the final gate.",
    });
    expect(screeningPanel(ScreeningVerdict.REVIEW)).toEqual({
      title: "Photo needs human judgment",
      body: "The visual result is inconclusive (Review). Use all three checks. Reject whenever unsure.",
    });
    expect(screeningPanel(ScreeningVerdict.FLAG)).toEqual({
      title: "Visual screening flagged",
      body: "Visible spoilage was detected. Accept pickup is disabled. Reject pickup and enter the reason.",
    });
  });
});

describe("canAcceptPickup", () => {
  const base = {
    photoUploaded: true,
    verdict: ScreeningVerdict.PASS,
    answers: { matches: "yes", packaging: "yes", looks: "yes" },
    saving: false,
    locked: false,
  } as const;

  it("allows acceptance only with a photo, no FLAG and three Yes answers", () => {
    expect(canAcceptPickup({ ...base })).toBe(true);
  });

  it("refuses without a photo, on FLAG, on any No and on a blank answer", () => {
    expect(canAcceptPickup({ ...base, photoUploaded: false })).toBe(false);
    expect(canAcceptPickup({ ...base, verdict: ScreeningVerdict.FLAG })).toBe(false);
    expect(canAcceptPickup({ ...base, answers: { ...base.answers, looks: "no" } })).toBe(false);
    expect(canAcceptPickup({ ...base, answers: { matches: "yes", packaging: "yes" } })).toBe(false);
  });

  it("refuses while saving and once the inspection is locked, but allows a REVIEW photo", () => {
    expect(canAcceptPickup({ ...base, saving: true })).toBe(false);
    expect(canAcceptPickup({ ...base, locked: true })).toBe(false);
    expect(canAcceptPickup({ ...base, verdict: ScreeningVerdict.REVIEW })).toBe(true);
  });
});

describe("canRejectPickup", () => {
  it("needs an uploaded photo and a non-blank reason", () => {
    expect(canRejectPickup({ photoUploaded: true, reason: " Too warm ", saving: false, locked: false })).toBe(
      true,
    );
    expect(canRejectPickup({ photoUploaded: true, reason: "   ", saving: false, locked: false })).toBe(
      false,
    );
    expect(canRejectPickup({ photoUploaded: false, reason: "Too warm", saving: false, locked: false })).toBe(
      false,
    );
  });

  it("is refused while saving or after the answers are locked", () => {
    expect(canRejectPickup({ photoUploaded: true, reason: "Too warm", saving: true, locked: false })).toBe(
      false,
    );
    expect(canRejectPickup({ photoUploaded: true, reason: "Too warm", saving: false, locked: true })).toBe(
      false,
    );
  });
});

describe("reject reasons", () => {
  it("combines a category and a note, trimming both", () => {
    expect(combineReason("", "")).toBe("");
    expect(combineReason("   ", "  ")).toBe("");
    expect(combineReason("Other", "")).toBe("Other");
    expect(combineReason("", "Too warm")).toBe("Too warm");
    expect(combineReason("Other", "Still warm")).toBe("Other: Still warm");
    expect(combineReason("  Other  ", "  Still warm  ")).toBe("Other: Still warm");
  });

  it("confirms a rejection only with a category and the desktop rules", () => {
    expect(canConfirmRejection({ category: "Other", canReject: true })).toBe(true);
    expect(canConfirmRejection({ category: "", canReject: true })).toBe(false);
    expect(canConfirmRejection({ category: "Other", canReject: false })).toBe(false);
    expect(canConfirmRejection({ category: "", canReject: false })).toBe(false);
  });

  it("lists the four unique categories, each short enough for one line", () => {
    expect(REJECT_REASONS).toHaveLength(4);
    expect(new Set(REJECT_REASONS).size).toBe(REJECT_REASONS.length);
    for (const reason of REJECT_REASONS) expect(reason.length).toBeLessThanOrEqual(90);
  });
});

describe("canScreenStaged", () => {
  it("is true only for a staged preview that is not locked", () => {
    expect(canScreenStaged({ staged: true, locked: false })).toBe(true);
    expect(canScreenStaged({ staged: true, locked: true })).toBe(false);
    expect(canScreenStaged({ staged: false, locked: false })).toBe(false);
    expect(canScreenStaged({ staged: false, locked: true })).toBe(false);
  });
});

describe("inspectionBody", () => {
  it("sends an unselected answer as false", () => {
    expect(inspectionBody({ matches: "yes" }, "")).toEqual({
      matchesDescription: true,
      packagingSealedClean: false,
      looksSmellsNormal: false,
    });
  });

  it("sends no reason for an acceptance and the trimmed reason for a rejection", () => {
    const yes = { matches: "yes", packaging: "yes", looks: "yes" } as const;
    expect(inspectionBody(yes, "")).not.toHaveProperty("reason");
    expect(inspectionBody(yes, "   ")).not.toHaveProperty("reason");
    expect(inspectionBody({ matches: "yes", looks: "no" }, "  Too warm  ")).toEqual({
      matchesDescription: true,
      packagingSealedClean: false,
      looksSmellsNormal: false,
      reason: "Too warm",
    });
  });
});

describe("errorMessage", () => {
  it("does not offer a retry for a session or role problem", () => {
    expect(errorMessage(401, "UNAUTHENTICATED")).toEqual({
      message: "Your session has expired. Log in again.",
      href: null,
      linkLabel: null,
      retry: false,
    });
    expect(errorMessage(403, "FORBIDDEN")).toEqual({
      message: "This page is for volunteers.",
      href: null,
      linkLabel: null,
      retry: false,
    });
  });

  it("points SCAN_REQUIRED back at the scan screen", () => {
    expect(errorMessage(409, "SCAN_REQUIRED")).toEqual({
      message: "Scan the QR label again before inspecting.",
      href: "/volunteer/scan",
      linkLabel: "Scan the QR label",
      retry: false,
    });
  });

  it("explains a missing photo and a blocked screening", () => {
    expect(errorMessage(409, "PHOTO_REQUIRED")).toEqual({
      message: "Upload a photo of the food first.",
      href: null,
      linkLabel: null,
      retry: false,
    });
    expect(errorMessage(409, "SCREENING_BLOCKED")).toEqual({
      message:
        "Visible spoilage was detected. Accept pickup is disabled. Reject pickup and enter the reason.",
      href: null,
      linkLabel: null,
      retry: false,
    });
  });

  it("sends INVALID_STATE, NOT_FOUND and INSPECTION_REQUIRED back to the task list", () => {
    for (const code of ["INVALID_STATE", "NOT_FOUND", "INSPECTION_REQUIRED"]) {
      expect(errorMessage(409, code)).toEqual({
        message: "This donation can no longer be inspected.",
        href: "/volunteer",
        linkLabel: "Back to your tasks",
        retry: false,
      });
    }
  });

  it("offers a retry only for a server fault or an unknown answer", () => {
    expect(errorMessage(500, "INTERNAL_ERROR")).toEqual({
      message: "Could not reach the server.",
      href: null,
      linkLabel: null,
      retry: true,
    });
    expect(errorMessage(0, null).retry).toBe(true);
  });
});

describe("errorCode", () => {
  it("reads only a string error field", () => {
    expect(errorCode({ error: "SCAN_REQUIRED" })).toBe("SCAN_REQUIRED");
    expect(errorCode({ error: 5 })).toBeNull();
    expect(errorCode(null)).toBeNull();
    expect(errorCode("SCAN_REQUIRED")).toBeNull();
  });
});

describe("checkPhotoFile", () => {
  it("accepts JPEG, PNG and WebP up to 4 MB", () => {
    expect(checkPhotoFile({ type: "image/jpeg", size: 1000 })).toEqual({ ok: true });
    expect(checkPhotoFile({ type: "image/png", size: 1000 })).toEqual({ ok: true });
    expect(checkPhotoFile({ type: "image/webp", size: 1000 })).toEqual({ ok: true });
    expect(checkPhotoFile({ type: "image/webp", size: MAX_PHOTO_BYTES })).toEqual({ ok: true });
  });

  it("refuses another type, an empty file and a file over 4 MB", () => {
    expect(checkPhotoFile({ type: "image/gif", size: 1000 })).toEqual({
      ok: false,
      message: "Choose a JPEG, PNG or WebP photo.",
    });
    expect(checkPhotoFile({ type: "image/jpeg", size: 0 })).toEqual({
      ok: false,
      message: "The photo is empty.",
    });
    expect(checkPhotoFile({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toEqual({
      ok: false,
      message: "The photo must be 4 MB or smaller.",
    });
  });
});

describe("response parsing", () => {
  it("reads the photo verdict only from the contract shape", () => {
    expect(parsePhotoResponse({ verdict: "REVIEW", screeningId: "s1" })).toBe("REVIEW");
    expect(parsePhotoResponse({ verdict: "MAYBE", screeningId: "s1" })).toBeNull();
    expect(parsePhotoResponse(null)).toBeNull();
  });

  it("reads the recorded decision", () => {
    expect(parseOutcomeDecision({ status: "PICKED_UP", decision: "ACCEPTED" })).toBe(
      PickupDecision.ACCEPTED,
    );
    expect(parseOutcomeDecision({ status: "REJECTED_AT_PICKUP", decision: "REJECTED" })).toBe(
      PickupDecision.REJECTED,
    );
    expect(parseOutcomeDecision({ status: "PICKED_UP" })).toBeNull();
  });

  it("validates the checklist body", () => {
    expect(
      parseChecklist({
        preparedAt: null,
        consumeByAt: null,
        storageCondition: "HOT_HELD",
        storageTemperatureC: 63,
        packagingIntact: true,
        allergensConfirmed: true,
        notCustomerPlateLeftovers: null,
        allergens: ["Soy"],
      }),
    ).toEqual({
      preparedAt: null,
      consumeByAt: null,
      storageCondition: "HOT_HELD",
      storageTemperatureC: 63,
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: null,
      allergens: ["Soy"],
    });
    expect(parseChecklist({ allergens: [] })).toBeNull();
  });
});

describe("task detail and questions", () => {
  const item: TaskDetail = {
    donationId: "11111111-1111-4111-8111-111111111111",
    shortCode: "A1B2C3D4",
    foodName: "Vegetable rice bowls",
    category: "Prepared meals",
    portions: 40,
    status: "ASSIGNED",
    pickupAddress: "1 Test Street",
    pickupStart: new Date(2026, 10, 21, 15, 0).toISOString(),
    pickupEnd: new Date(2026, 10, 21, 18, 0).toISOString(),
    donorName: "Test Donor",
    donorPhone: "+630000000000",
  };

  it("reads the task detail body and keeps a hidden phone null", () => {
    expect(parseTaskDetail(item)).toEqual(item);
    expect(parseTaskDetail({ ...item, donorPhone: null })).toEqual({ ...item, donorPhone: null });
  });

  it("rejects a body with an unknown status or a missing field", () => {
    expect(parseTaskDetail({ ...item, status: "CLOSED" })).toBeNull();
    expect(parseTaskDetail(null)).toBeNull();
    const missing: Record<string, unknown> = { ...item };
    delete missing.donorPhone;
    expect(parseTaskDetail(missing)).toBeNull();
  });

  it("asks for the real portion count, or stays generic before it loads", () => {
    expect(checkQuestions(40)[0]?.question).toBe(
      "Does it match the description and 40 portions?",
    );
    expect(checkQuestions(null)[0]?.question).toBe(
      "Does it match the description and the portions listed?",
    );
    expect(checkQuestions(40)).toHaveLength(3);
  });
});

describe("outcomePanel", () => {
  it("names the recorded pickup and claims no notification for a rejection", () => {
    expect(outcomePanel(PickupDecision.ACCEPTED)).toEqual({
      title: "Pickup recorded",
      body: "The food is now picked up. Take it to the distribution point.",
    });
    expect(outcomePanel(PickupDecision.REJECTED)).toEqual({
      title: "Pickup rejected",
      body: "The donation was not collected.",
    });
  });
});
