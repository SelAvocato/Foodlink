import { describe, expect, it } from "vitest";
import { screeningDecisionSchema } from "@/contracts/screening-decision";
import {
  caseTitle,
  checklistLines,
  confidenceLabel,
  countLabel,
  decisionMessage,
  nextAfterDecision,
  parseScreeningQueue,
  passBody,
  reasonText,
  reconcileActive,
  shortCode,
  showQueueError,
  storageConditionLabel,
  validateReject,
  type ScreeningCase,
  type ScreeningCaseChecklist,
} from "./screening-reviews-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";

/** A raw API case as JSON, so parseScreeningQueue sees the real body shape. */
function rawCase(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    screeningId: "22222222-2222-4222-8222-222222222222",
    donationId: DONATION_ID,
    createdAt: "2026-11-15T01:00:00.000Z",
    confidence: 0.42,
    signs: ["Image is too dim"],
    notes: "Visible condition not clear",
    donation: { foodName: "Fresh produce", portions: 12, categoryCode: "PRODUCE" },
    checklist: null,
    photoUrl: "https://signed.example/food.jpg?token=abc",
    ...patch,
  };
}

function screeningCase(patch: Partial<ScreeningCase> = {}): ScreeningCase {
  const items = parseScreeningQueue({ screenings: [rawCase()] });
  if (items === null) throw new Error("test fixture is not a valid queue response");
  return { ...items[0], ...patch };
}

function checklist(patch: Partial<ScreeningCaseChecklist> = {}): ScreeningCaseChecklist {
  return {
    preparedAt: "2026-11-04T01:04:00.000Z",
    consumeByAt: null,
    storageCondition: "REFRIGERATED",
    storageTemperatureC: 4,
    packagingIntact: true,
    allergensConfirmed: false,
    notCustomerPlateLeftovers: null,
    completedAt: null,
    ...patch,
  };
}

describe("shortCode", () => {
  it("takes the first 8 characters of the donation id, upper case", () => {
    expect(shortCode(DONATION_ID)).toBe("9FC03951");
  });

  it("upper-cases a lower-case id and never grows past 8 characters", () => {
    expect(shortCode("abcdefghijkl")).toBe("ABCDEFGH");
  });

  it("keeps a short id as it is", () => {
    expect(shortCode("ab")).toBe("AB");
  });
});

describe("caseTitle", () => {
  it("builds #CODE · foodName", () => {
    expect(caseTitle(screeningCase())).toBe("#9FC03951 · Fresh produce");
  });
});

describe("countLabel", () => {
  it("counts the loaded queue", () => {
    expect(countLabel(0)).toBe("0 awaiting review");
    expect(countLabel(2)).toBe("2 awaiting review");
  });
});

describe("confidenceLabel", () => {
  it("labels the Low band and prints the rounded percentage", () => {
    expect(confidenceLabel(0)).toBe("0% · Low · Human assessment needed");
    expect(confidenceLabel(0.42)).toBe("42% · Low · Human assessment needed");
  });

  it("picks the band from the rounded percent, not the exact value", () => {
    expect(confidenceLabel(0.499)).toBe("50% · Medium · Human assessment needed");
    expect(confidenceLabel(0.494)).toBe("49% · Low · Human assessment needed");
    expect(confidenceLabel(0.799)).toBe("80% · High · Human assessment needed");
    expect(confidenceLabel(0.794)).toBe("79% · Medium · Human assessment needed");
  });

  it("starts Medium at exactly 0.5", () => {
    expect(confidenceLabel(0.5)).toBe("50% · Medium · Human assessment needed");
    expect(confidenceLabel(0.79)).toBe("79% · Medium · Human assessment needed");
  });

  it("starts High at exactly 0.8", () => {
    expect(confidenceLabel(0.8)).toBe("80% · High · Human assessment needed");
    expect(confidenceLabel(1)).toBe("100% · High · Human assessment needed");
  });

  it("has its own line for a null confidence", () => {
    expect(confidenceLabel(null)).toBe("Not available · Human assessment needed");
  });
});

describe("reasonText", () => {
  it("shows the notes alone", () => {
    expect(reasonText("Image is too dim", [])).toBe("Image is too dim");
  });

  it("shows the signs alone and skips empty signs", () => {
    expect(reasonText(null, ["Knife not visible", "", "  "])).toBe("Knife not visible");
  });

  it("joins the notes with every sign, in order", () => {
    expect(reasonText("Image is too dim", ["Knife not visible", "Unknown source"])).toBe(
      "Image is too dim · Knife not visible · Unknown source",
    );
  });

  it("says No reason given when notes and signs are both empty", () => {
    expect(reasonText(null, [])).toBe("No reason given");
    expect(reasonText("   ", [""])).toBe("No reason given");
    expect(reasonText("", [])).toBe("No reason given");
  });
});

describe("checklistLines", () => {
  it("shows one day-first Manila line per field", () => {
    expect(checklistLines(checklist())).toEqual([
      "Prepared: 4 Nov 2026",
      "Consume by: Not set",
      "Storage: Refrigerated · 4°C",
      "Packaging intact: Yes",
      "Allergens confirmed: No",
      "Not customer plate leftovers: Not set",
      "Completed: Not set",
    ]);
  });

  it("uses the Manila date, not the UTC one", () => {
    // 4 Nov 23:30Z is already 5 Nov in Manila.
    expect(checklistLines(checklist({ consumeByAt: "2026-11-04T23:30:00.000Z" }))[1]).toBe(
      "Consume by: 5 Nov 2026",
    );
  });

  it("shows a temperature without a condition and Not set for both missing", () => {
    expect(checklistLines(checklist({ storageCondition: null }))[2]).toBe("Storage: 4°C");
    expect(
      checklistLines(checklist({ storageCondition: null, storageTemperatureC: null }))[2],
    ).toBe("Storage: Not set");
    expect(checklistLines(checklist({ storageTemperatureC: -18 }))[2]).toBe(
      "Storage: Refrigerated · -18°C",
    );
  });

  it("says Not set when the whole checklist is empty", () => {
    expect(
      checklistLines(
        checklist({
          preparedAt: null,
          storageCondition: null,
          storageTemperatureC: null,
          packagingIntact: null,
          allergensConfirmed: null,
        }),
      ),
    ).toEqual([
      "Prepared: Not set",
      "Consume by: Not set",
      "Storage: Not set",
      "Packaging intact: Not set",
      "Allergens confirmed: Not set",
      "Not customer plate leftovers: Not set",
      "Completed: Not set",
    ]);
  });
});

describe("storageConditionLabel", () => {
  it("maps the four codes", () => {
    expect(storageConditionLabel("ROOM_TEMPERATURE")).toBe("Room temperature");
    expect(storageConditionLabel("HOT_HELD")).toBe("Hot held");
    expect(storageConditionLabel("REFRIGERATED")).toBe("Refrigerated");
    expect(storageConditionLabel("FROZEN")).toBe("Frozen");
  });

  it("does not resolve inherited names", () => {
    expect(storageConditionLabel("__proto__")).toBe("__proto__");
    expect(storageConditionLabel("constructor")).toBe("constructor");
    expect(storageConditionLabel("toString")).toBe("toString");
  });
});

describe("parseScreeningQueue", () => {
  it("reads a valid queue response", () => {
    const items = parseScreeningQueue({ screenings: [rawCase()] });
    expect(items).not.toBeNull();
    expect(items).toHaveLength(1);
    expect(items?.[0]).toMatchObject({
      donationId: DONATION_ID,
      confidence: 0.42,
      photoUrl: "https://signed.example/food.jpg?token=abc",
    });
  });

  it("accepts a null photo, a null confidence, empty signs and a full checklist", () => {
    const items = parseScreeningQueue({
      screenings: [
        rawCase({
          photoUrl: null,
          confidence: null,
          signs: [],
          notes: null,
          checklist: checklist({ completedAt: "2026-11-04T01:04:00.000Z" }),
        }),
      ],
    });
    expect(items?.[0].photoUrl).toBeNull();
    expect(items?.[0].confidence).toBeNull();
    expect(items?.[0].checklist?.completedAt).toBe("2026-11-04T01:04:00.000Z");
  });

  it("returns null for a broken shape instead of rendering blanks", () => {
    expect(parseScreeningQueue(null)).toBeNull();
    expect(parseScreeningQueue({})).toBeNull();
    expect(parseScreeningQueue({ screenings: [rawCase({ status: "PENDING" })] })).toBeNull();
    expect(parseScreeningQueue({ screenings: [rawCase({ createdAt: "yesterday" })] })).toBeNull();
    expect(
      parseScreeningQueue({ screenings: [rawCase({ checklist: { preparedAt: null } })] }),
    ).toBeNull();
  });
});

describe("decision bodies", () => {
  it("builds a PASS body with no reason, which the contract accepts", () => {
    const body = passBody();
    expect(body).toEqual({ decision: "PASS" });
    expect(screeningDecisionSchema.safeParse(body).success).toBe(true);
  });

  it("builds a REJECT body from a trimmed reason, which the contract accepts", () => {
    const result = validateReject("  Image is too dim  ");
    expect(result).toEqual({ ok: true, body: { decision: "REJECT", reason: "Image is too dim" } });
    if (result.ok) expect(screeningDecisionSchema.safeParse(result.body).success).toBe(true);
  });

  it("refuses an empty reason", () => {
    expect(validateReject("")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("refuses a whitespace-only reason", () => {
    expect(validateReject("   \n\t  ")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("refuses a reason that strips to nothing", () => {
    expect(validateReject(" <> ")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("accepts exactly 500 characters and refuses 501", () => {
    const accepted = validateReject("x".repeat(500));
    expect(accepted.ok).toBe(true);
    expect(validateReject("x".repeat(501))).toEqual({
      ok: false,
      message: "Use at most 500 characters",
    });
  });
});

describe("decisionMessage", () => {
  it("maps 401 and 403 to the not-signed-in-as-Admin message", () => {
    expect(decisionMessage(401, { error: "UNAUTHENTICATED" })).toEqual({
      message: "You are not signed in as an Admin.",
      refill: false,
    });
    expect(decisionMessage(403, { error: "FORBIDDEN" })).toEqual({
      message: "You are not signed in as an Admin.",
      refill: false,
    });
  });

  it("maps 404 to a case that no longer exists, and refills", () => {
    expect(decisionMessage(404, { error: "NOT_FOUND" })).toEqual({
      message: "This case no longer exists.",
      refill: true,
    });
  });

  it("maps 409 NOT_PENDING to an already-decided case, and refills", () => {
    expect(decisionMessage(409, { error: "NOT_PENDING" })).toEqual({
      message: "Someone already decided this case.",
      refill: true,
    });
  });

  it("does not treat another 409 code as already decided", () => {
    expect(decisionMessage(409, { error: "SOMETHING_ELSE" })).toEqual({
      message: "The decision could not be saved. Please try again.",
      refill: false,
    });
    expect(decisionMessage(409, null)).toEqual({
      message: "The decision could not be saved. Please try again.",
      refill: false,
    });
  });

  it("maps 400 and 500 to the generic could-not-save message", () => {
    expect(decisionMessage(400, { error: "INVALID_REQUEST" })).toEqual({
      message: "The decision could not be saved. Please try again.",
      refill: false,
    });
    expect(decisionMessage(500, { error: "INTERNAL_ERROR" })).toEqual({
      message: "The decision could not be saved. Please try again.",
      refill: false,
    });
    expect(decisionMessage(500, "not json")).toEqual({
      message: "The decision could not be saved. Please try again.",
      refill: false,
    });
  });

  it("never renders a server message", () => {
    const body = { error: "NOT_PENDING", message: "That screening is not awaiting a decision." };
    expect(decisionMessage(409, body).message).not.toContain("not awaiting");
  });
});

describe("reconcileActive", () => {
  const OTHER_ID = "33333333-3333-4333-8333-333333333333";

  it("shows the first case when nothing is pinned", () => {
    const first = screeningCase();
    const second = screeningCase({ screeningId: OTHER_ID });
    expect(reconcileActive(null, [first, second])).toEqual({ current: first, gone: false });
  });

  it("has no current case when nothing is pinned and the queue is empty", () => {
    expect(reconcileActive(null, [])).toEqual({ current: null, gone: false });
  });

  it("returns the fresh copy of a pinned case that is still in the queue", () => {
    const pinned = screeningCase();
    const fresh = screeningCase({ photoUrl: "https://signed.example/renewed.jpg?token=new" });
    const result = reconcileActive(pinned, [fresh]);
    expect(result.gone).toBe(false);
    expect(result.current).toBe(fresh);
    expect(result.current?.photoUrl).toBe("https://signed.example/renewed.jpg?token=new");
  });

  it("keeps the pinned copy and flags gone when it left the queue", () => {
    const pinned = screeningCase();
    const other = screeningCase({ screeningId: OTHER_ID });
    const result = reconcileActive(pinned, [other]);
    expect(result.gone).toBe(true);
    expect(result.current).toBe(pinned);
  });
});

describe("nextAfterDecision", () => {
  const OTHER_ID = "33333333-3333-4333-8333-333333333333";

  it("skips the decided case and returns the next", () => {
    const decided = screeningCase();
    const next = screeningCase({ screeningId: OTHER_ID });
    expect(nextAfterDecision([decided, next], decided.screeningId)).toBe(next);
  });

  it("returns null when the decided case was the only one", () => {
    const decided = screeningCase();
    expect(nextAfterDecision([decided], decided.screeningId)).toBeNull();
  });

  it("returns the first case when the decided id is not in the list", () => {
    const first = screeningCase();
    expect(nextAfterDecision([first], "not-in-the-queue")).toBe(first);
  });
});

describe("showQueueError", () => {
  it("is true for an error state whatever the other inputs are", () => {
    expect(showQueueError("error", 0, false, false)).toBe(true);
    expect(showQueueError("error", 0, true, true)).toBe(true);
    expect(showQueueError("error", 3, false, true)).toBe(true);
    expect(showQueueError("error", 3, true, false)).toBe(true);
  });

  it("is true for an emptied ready queue with no case and a failed refresh", () => {
    expect(showQueueError("ready", 0, false, true)).toBe(true);
  });

  it("is false for an emptied ready queue that still shows a retained case", () => {
    expect(showQueueError("ready", 0, true, true)).toBe(false);
  });

  it("is false for an emptied ready queue without a failed refresh, so the empty message shows", () => {
    expect(showQueueError("ready", 0, false, false)).toBe(false);
  });

  it("is false for a ready queue that still has cases", () => {
    expect(showQueueError("ready", 3, true, true)).toBe(false);
    expect(showQueueError("ready", 1, false, true)).toBe(false);
  });

  it("is false while loading, whatever the refresh state is", () => {
    expect(showQueueError("loading", 0, false, false)).toBe(false);
    expect(showQueueError("loading", 0, false, true)).toBe(false);
  });
});
