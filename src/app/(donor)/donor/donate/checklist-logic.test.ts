import { describe, expect, it } from "vitest";
import { GENERIC_ERROR } from "./photo-step-logic";
import {
  allergenCodesFromDraftList,
  allergenLabel,
  buildChecklistBody,
  deriveInitialForm,
  fromIsoToLocalInput,
  missingMessages,
  messageForChecklistError,
  parseChecklistLoad,
  parseSaveResponse,
  toIsoWithOffset,
  toggleAllergen,
  toggleNone,
  type ChecklistForm,
  type ChecklistView,
} from "./checklist-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";
const OTHER_ID = "8ab1e2a0-2222-4222-9222-222222222222";

const BOTH = { requiresPreparedTime: true, requiresStorageInfo: true };
const NEITHER = { requiresPreparedTime: false, requiresStorageInfo: false };

function emptyForm(overrides: Partial<ChecklistForm> = {}): ChecklistForm {
  return {
    preparedAt: "",
    consumeByAt: "",
    storageCondition: "",
    storageTemperature: "",
    allergenCodes: [],
    noneSelected: false,
    packagingIntact: false,
    notCustomerPlateLeftovers: false,
    ...overrides,
  };
}

/** An ISO value built from a local wall time; fails the test when there is none. */
function isoOf(local: string): string {
  const value = toIsoWithOffset(local);
  if (value === null) throw new Error(`expected ${local} to convert to an ISO value`);
  return value;
}

/** The body's date must name the same instant as the local input, whatever the timezone. */
function expectSameInstant(value: string | undefined, local: string): void {
  if (value === undefined) throw new Error("expected the body to carry that date");
  expect(new Date(value).getTime()).toBe(new Date(local).getTime());
}

const savedChecklist: ChecklistView = {
  preparedAt: new Date(2026, 0, 2, 8, 15).toISOString(),
  consumeByAt: new Date(2026, 0, 3, 18, 0).toISOString(),
  storageCondition: "REFRIGERATED",
  storageTemperatureC: 4,
  packagingIntact: true,
  allergensConfirmed: true,
  notCustomerPlateLeftovers: true,
};

describe("toIsoWithOffset", () => {
  it("keeps the instant of the local input", () => {
    const local = "2026-06-15T14:30";
    const iso = isoOf(local);
    expect(new Date(iso).getTime()).toBe(new Date(local).getTime());
  });

  it("writes a full offset so the contract accepts it", () => {
    expect(isoOf("2026-06-15T14:30")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/);
  });

  it("returns null for an empty or invalid value", () => {
    expect(toIsoWithOffset("")).toBeNull();
    expect(toIsoWithOffset("   ")).toBeNull();
    expect(toIsoWithOffset("not a date")).toBeNull();
    expect(toIsoWithOffset("2026-13-45T99:99")).toBeNull();
  });
});

describe("fromIsoToLocalInput", () => {
  it("round trips a local value through the ISO form", () => {
    const local = "2026-12-31T23:05";
    expect(fromIsoToLocalInput(isoOf(local))).toBe(local);
  });

  it("reads an ISO value with the local getters", () => {
    const iso = new Date(2026, 5, 15, 14, 30).toISOString();
    expect(fromIsoToLocalInput(iso)).toBe("2026-06-15T14:30");
  });

  it("returns an empty value for a missing or unreadable date", () => {
    expect(fromIsoToLocalInput(null)).toBe("");
    expect(fromIsoToLocalInput("")).toBe("");
    expect(fromIsoToLocalInput("yesterday")).toBe("");
  });
});

describe("buildChecklistBody dates", () => {
  it("sends a filled date as the same instant", () => {
    const body = buildChecklistBody(emptyForm({ consumeByAt: "2026-06-15T14:30" }), NEITHER);
    expectSameInstant(body.consumeByAt, "2026-06-15T14:30");
  });

  it("omits an empty or invalid date", () => {
    const body = buildChecklistBody(
      emptyForm({ preparedAt: "", consumeByAt: "not a date" }),
      BOTH,
    );
    expect(body).not.toHaveProperty("preparedAt");
    expect(body).not.toHaveProperty("consumeByAt");
  });
});

describe("buildChecklistBody fields", () => {
  it("omits the fields the category does not use", () => {
    const form = emptyForm({
      preparedAt: "2026-06-15T14:30",
      storageCondition: "FROZEN",
      storageTemperature: "-18",
    });
    const body = buildChecklistBody(form, NEITHER);
    expect(body).not.toHaveProperty("preparedAt");
    expect(body).not.toHaveProperty("storageCondition");
    expect(body).not.toHaveProperty("storageTemperatureC");
  });

  it("sends the fields the category does use", () => {
    const body = buildChecklistBody(
      emptyForm({
        preparedAt: "2026-06-15T14:30",
        storageCondition: "FROZEN",
        storageTemperature: "-18",
      }),
      BOTH,
    );
    expectSameInstant(body.preparedAt, "2026-06-15T14:30");
    expect(body.storageCondition).toBe("FROZEN");
    expect(body.storageTemperatureC).toBe(-18);
  });

  it("always sends the three confirmations as booleans", () => {
    const body = buildChecklistBody(
      emptyForm({ packagingIntact: true, notCustomerPlateLeftovers: true, noneSelected: true }),
      NEITHER,
    );
    expect(body).toMatchObject({
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: true,
    });
    expect(buildChecklistBody(emptyForm(), NEITHER)).toMatchObject({
      packagingIntact: false,
      allergensConfirmed: false,
      notCustomerPlateLeftovers: false,
    });
  });

  it("omits an empty or unknown storage condition", () => {
    expect(buildChecklistBody(emptyForm({ storageCondition: "" }), BOTH)).not.toHaveProperty(
      "storageCondition",
    );
    expect(
      buildChecklistBody(emptyForm({ storageCondition: "SOMEWHERE" }), BOTH),
    ).not.toHaveProperty("storageCondition");
  });
});

describe("buildChecklistBody temperature", () => {
  const unusable: [string][] = [[""], ["   "], ["abc"], ["12abc"], ["-51"], ["101"], ["1e999"]];

  it.each(unusable)("omits the temperature %j", (value) => {
    const body = buildChecklistBody(emptyForm({ storageTemperature: value }), BOTH);
    expect(body).not.toHaveProperty("storageTemperatureC");
  });

  const usable: [string, number][] = [
    ["0", 0],
    ["12.5", 12.5],
    ["-50", -50],
    ["100", 100],
  ];

  it.each(usable)("sends the temperature %s as %d", (value, expected) => {
    const body = buildChecklistBody(emptyForm({ storageTemperature: value }), BOTH);
    expect(body.storageTemperatureC).toBe(expected);
  });
});

describe("allergen selection", () => {
  it("clears every allergen when None is ticked", () => {
    const next = toggleNone(emptyForm({ allergenCodes: ["MILK", "EGGS"] }));
    expect(next.allergenCodes).toEqual([]);
    expect(next.noneSelected).toBe(true);
  });

  it("clears None when an allergen is ticked", () => {
    const next = toggleAllergen(emptyForm({ noneSelected: true }), "MILK");
    expect(next.noneSelected).toBe(false);
    expect(next.allergenCodes).toEqual(["MILK"]);
  });

  it("unticks an allergen without touching None", () => {
    const next = toggleAllergen(emptyForm({ allergenCodes: ["MILK"] }), "MILK");
    expect(next.allergenCodes).toEqual([]);
    expect(next.noneSelected).toBe(false);
  });

  it("unticks None without inventing allergens", () => {
    const next = toggleNone(emptyForm({ noneSelected: true }));
    expect(next.noneSelected).toBe(false);
    expect(next.allergenCodes).toEqual([]);
  });

  it("confirms when at least one allergen or None is ticked", () => {
    expect(buildChecklistBody(emptyForm({ allergenCodes: ["MILK"] }), NEITHER).allergensConfirmed).toBe(true);
    expect(buildChecklistBody(emptyForm({ noneSelected: true }), NEITHER).allergensConfirmed).toBe(true);
    expect(buildChecklistBody(emptyForm(), NEITHER).allergensConfirmed).toBe(false);
  });
});

describe("deriveInitialForm", () => {
  it("fills the form from a saved checklist", () => {
    const form = deriveInitialForm({ checklist: savedChecklist, allergenCodes: ["MILK"] });
    expect(form.preparedAt).toBe("2026-01-02T08:15");
    expect(form.consumeByAt).toBe("2026-01-03T18:00");
    expect(form.storageCondition).toBe("REFRIGERATED");
    expect(form.storageTemperature).toBe("4");
    expect(form.packagingIntact).toBe(true);
    expect(form.notCustomerPlateLeftovers).toBe(true);
    expect(form.allergenCodes).toEqual(["MILK"]);
    expect(form.noneSelected).toBe(false);
  });

  it("ticks None when a confirmed checklist has no allergens", () => {
    const form = deriveInitialForm({ checklist: savedChecklist, allergenCodes: [] });
    expect(form.noneSelected).toBe(true);
    expect(form.allergenCodes).toEqual([]);
  });

  it("does not tick None when the allergens were never confirmed", () => {
    const form = deriveInitialForm({
      checklist: { ...savedChecklist, allergensConfirmed: false },
      allergenCodes: [],
    });
    expect(form.noneSelected).toBe(false);
  });

  it("starts from an empty form when there is no checklist yet", () => {
    expect(deriveInitialForm({ checklist: null, allergenCodes: ["MILK"] })).toEqual(
      emptyForm({ allergenCodes: ["MILK"] }),
    );
    expect(deriveInitialForm({ checklist: null, allergenCodes: [] })).toEqual(emptyForm());
  });
});

describe("missingMessages", () => {
  const cases: [string, string][] = [
    ["consumeByAt", "Add a consume-by time."],
    ["packagingIntact", "Confirm that the packaging is intact."],
    ["allergensConfirmed", "Declare the allergens, or tick None."],
    ["notCustomerPlateLeftovers", "Confirm the food is not plate leftovers."],
    ["preparedAt", "Add the time prepared."],
    ["storageCondition", "Choose a storage condition."],
    ["storageTemperatureC", "Add the storage temperature (between -50 and 100 °C)."],
  ];

  it.each(cases)("maps the missing code %s to a message", (code, message) => {
    expect(missingMessages([code])).toEqual([message]);
  });

  it("maps a whole list in the order the server sent it", () => {
    expect(missingMessages(["consumeByAt", "packagingIntact"])).toEqual([
      "Add a consume-by time.",
      "Confirm that the packaging is intact.",
    ]);
  });

  it("drops a code it does not know instead of showing server text", () => {
    expect(missingMessages(["somethingNew"])).toEqual([]);
    expect(missingMessages([])).toEqual([]);
  });
});

describe("messageForChecklistError", () => {
  const cases: [string, string][] = [
    ["NOT_FOUND", "The draft was not found."],
    ["NOT_EDITABLE", "That draft can no longer be changed."],
    ["CONSUME_BY_NOT_AFTER_PREPARED", "The consume-by time must be after the prepared time."],
    ["CONSUME_BY_NOT_AFTER_PICKUP_END", "The consume-by time must be after the pickup window ends."],
    ["INVALID_REQUEST", "That request was not valid. Please try again."],
    ["INTERNAL_ERROR", GENERIC_ERROR],
    ["UNAUTHENTICATED", "You are not signed in."],
    ["INACTIVE_ACCOUNT", "Your account is not active."],
    ["FORBIDDEN", "You do not have access to this action."],
    ["UNKNOWN_ALLERGEN", "One or more allergen codes are unknown."],
  ];

  it.each(cases)("maps the error code %s to a message", (code, message) => {
    expect(messageForChecklistError(code)).toBe(message);
  });

  it("falls back to the generic message for an unknown code and for none", () => {
    expect(messageForChecklistError("SOMETHING_NEW")).toBe(GENERIC_ERROR);
    expect(messageForChecklistError(undefined)).toBe(GENERIC_ERROR);
  });
});

describe("parseSaveResponse", () => {
  it("reads a complete save", () => {
    expect(parseSaveResponse({ donationId: DONATION_ID, complete: true, missing: [] })).toEqual({
      donationId: DONATION_ID,
      complete: true,
      missing: [],
    });
  });

  it("reads an incomplete save with its missing codes", () => {
    expect(
      parseSaveResponse({ donationId: DONATION_ID, complete: false, missing: ["consumeByAt"] }),
    ).toEqual({ donationId: DONATION_ID, complete: false, missing: ["consumeByAt"] });
  });

  const malformed: unknown[] = [
    null,
    undefined,
    "saved",
    {},
    { complete: true, missing: [] },
    { donationId: DONATION_ID, missing: [] },
    { donationId: "", complete: true, missing: [] },
    { donationId: DONATION_ID, complete: "yes", missing: [] },
    { donationId: DONATION_ID, complete: true },
    { donationId: DONATION_ID, complete: true, missing: "consumeByAt" },
    // Strict: an extra field is a shape drift, not something to render.
    { donationId: DONATION_ID, complete: true, missing: [], extra: true },
  ];

  it.each(malformed)("refuses the body %j", (body) => {
    expect(parseSaveResponse(body)).toBeNull();
  });
});

describe("parseChecklistLoad", () => {
  const loadBody = { checklist: savedChecklist, complete: false, missing: ["consumeByAt"] };

  it("reads a saved checklist", () => {
    expect(parseChecklistLoad(loadBody)).toEqual({ ok: true, checklist: savedChecklist });
  });

  it("reads a missing checklist row as an empty answer, not a failure", () => {
    expect(parseChecklistLoad({ checklist: null, complete: false, missing: ["consumeByAt"] })).toEqual({
      ok: true,
      checklist: null,
    });
  });

  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { checklist: null, complete: false },
    { checklist: null, missing: [] },
    { ...loadBody, checklist: 5 },
    { ...loadBody, checklist: { ...savedChecklist, preparedAt: 5 } },
    { ...loadBody, checklist: { ...savedChecklist, storageCondition: "SOMEWHERE" } },
    { ...loadBody, complete: "yes" },
    { ...loadBody, missing: "consumeByAt" },
  ];

  it.each(malformed)("refuses the body %j", (body) => {
    expect(parseChecklistLoad(body)).toEqual({ ok: false });
  });

  it("tolerates a field it does not know", () => {
    expect(parseChecklistLoad({ ...loadBody, addedLater: true })).toEqual({
      ok: true,
      checklist: savedChecklist,
    });
  });
});

describe("allergenLabel", () => {
  it("shortens the OTHER label the wizard cannot honour", () => {
    expect(
      allergenLabel({ code: "OTHER", name: "Other allergen (specify in description)" }),
    ).toBe("Other allergen");
  });

  it("keeps the server name for every other allergen", () => {
    expect(allergenLabel({ code: "MILK", name: "Milk and dairy" })).toBe("Milk and dairy");
  });
});

describe("allergenCodesFromDraftList", () => {
  const listBody = {
    drafts: [
      { id: OTHER_ID, allergenCodes: [] },
      { id: DONATION_ID, allergenCodes: ["MILK", "SESAME"] },
    ],
  };

  it("reads the codes of the wanted draft", () => {
    expect(allergenCodesFromDraftList(listBody, DONATION_ID)).toEqual(["MILK", "SESAME"]);
  });

  it("is not hidden by an unrelated bad entry", () => {
    expect(
      allergenCodesFromDraftList({ drafts: [{ id: OTHER_ID }, listBody.drafts[1]] }, DONATION_ID),
    ).toEqual(["MILK", "SESAME"]);
  });

  it("returns null when the list cannot be read", () => {
    expect(allergenCodesFromDraftList(null, DONATION_ID)).toBeNull();
    expect(allergenCodesFromDraftList({ drafts: "none" }, DONATION_ID)).toBeNull();
    expect(allergenCodesFromDraftList({ drafts: [] }, DONATION_ID)).toBeNull();
    expect(allergenCodesFromDraftList({ drafts: [{ id: DONATION_ID }] }, DONATION_ID)).toBeNull();
  });
});
