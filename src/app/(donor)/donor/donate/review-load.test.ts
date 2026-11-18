import { describe, expect, it } from "vitest";
import { decideReview, type ReviewInput } from "./review-load";

const ID = "9fc03951-1111-4111-8111-111111111111";
const OTHER_ID = "8ab1e2a0-2222-4222-9222-222222222222";

function draftsBody(overrides: Record<string, unknown> = {}) {
  return {
    drafts: [
      {
        id: ID,
        foodName: "Fresh bread rolls",
        portions: 24,
        allergenCodes: ["WHEAT_GLUTEN"],
        ...overrides,
      },
    ],
  };
}

function checklistBody(overrides: Record<string, unknown> = {}, complete = true) {
  return {
    checklist: {
      preparedAt: "2026-11-04T01:00:00.000Z",
      consumeByAt: "2026-11-04T10:00:00.000Z",
      storageCondition: null,
      storageTemperatureC: null,
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: true,
      ...overrides,
    },
    complete,
    missing: [],
  };
}

const PICKUP_BODY = {
  pickup: {
    address: {
      streetLine1: "18 Mabini Street",
      streetLine2: null,
      barangay: "Barangay Central",
      city: "Quezon City",
      provinceOrState: null,
      postalCode: null,
      countryCode: "PH",
      latitude: null,
      longitude: null,
    },
    pickupStart: "2026-11-04T07:00:00.000Z",
    pickupEnd: "2026-11-04T09:00:00.000Z",
  },
};

function input(overrides: Partial<ReviewInput> = {}): ReviewInput {
  return {
    donationId: ID,
    draftsBody: draftsBody(),
    checklistBody: checklistBody(),
    pickupBody: PICKUP_BODY,
    categoryName: "Bakery",
    requiresPreparedTime: true,
    donorLabel: "Establishment donor",
    allergenOptions: [{ code: "WHEAT_GLUTEN", name: "Wheat / gluten" }],
    timeZone: "UTC",
    ...overrides,
  };
}

describe("decideReview", () => {
  it("is ready with the summary built from the three reads", () => {
    expect(decideReview(input())).toEqual({
      kind: "ready",
      foodName: "Fresh bread rolls",
      summary: "24 portions · Bakery · Establishment donor",
      safetyLines: [
        "Visual screening: Passed",
        "Prepared: 4 Nov 2026, 1:00 AM",
        "Consume by: 4 Nov 2026, 10:00 AM",
        "Allergens: Wheat / gluten",
        "Packaging clean · No opened food or leftovers",
      ],
      pickupLines: ["4 Nov 2026 · 7:00–9:00 AM", "18 Mabini Street, Barangay Central", "Quezon City"],
    });
  });

  it("shows an allergen code the options do not know as the code itself", () => {
    const result = decideReview(input({ allergenOptions: [] }));
    expect(result.kind).toBe("ready");
    if (result.kind === "ready") expect(result.safetyLines).toContain("Allergens: WHEAT_GLUTEN");
  });

  it("needs the checklist when no checklist row exists", () => {
    expect(
      decideReview(input({ checklistBody: { checklist: null, complete: false, missing: [] } })),
    ).toEqual({ kind: "needs", step: "checklist" });
  });

  it("needs the checklist when it is not complete", () => {
    expect(decideReview(input({ checklistBody: checklistBody({}, false) }))).toEqual({
      kind: "needs",
      step: "checklist",
    });
  });

  it("needs the details while the food name is the placeholder", () => {
    expect(decideReview(input({ draftsBody: draftsBody({ foodName: "Untitled donation" }) }))).toEqual({
      kind: "needs",
      step: "details",
    });
  });

  it("needs the details when no pickup is saved", () => {
    expect(decideReview(input({ pickupBody: { pickup: null } }))).toEqual({
      kind: "needs",
      step: "details",
    });
  });

  it("judges the checklist before the details", () => {
    expect(
      decideReview(
        input({
          draftsBody: draftsBody({ foodName: "Untitled donation" }),
          checklistBody: checklistBody({}, false),
          pickupBody: { pickup: null },
        }),
      ),
    ).toEqual({ kind: "needs", step: "checklist" });
  });

  it("fails when the draft is not in the list", () => {
    expect(decideReview(input({ donationId: OTHER_ID }))).toEqual({ kind: "failed" });
  });

  it("fails on a body that is not the drafts list", () => {
    expect(decideReview(input({ draftsBody: { nope: true } }))).toEqual({ kind: "failed" });
  });

  it("fails when the draft entry has no usable allergen list", () => {
    expect(decideReview(input({ draftsBody: draftsBody({ allergenCodes: "x" }) }))).toEqual({
      kind: "failed",
    });
  });

  it("fails on an unreadable checklist body, never reading it as incomplete", () => {
    expect(decideReview(input({ checklistBody: { complete: "yes" } }))).toEqual({ kind: "failed" });
    expect(decideReview(input({ checklistBody: null }))).toEqual({ kind: "failed" });
  });

  it("fails on an unreadable pickup body, never reading it as no pickup", () => {
    expect(decideReview(input({ pickupBody: { pickup: "soon" } }))).toEqual({ kind: "failed" });
    expect(decideReview(input({ pickupBody: undefined }))).toEqual({ kind: "failed" });
  });
});
