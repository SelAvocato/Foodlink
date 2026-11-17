import { describe, expect, it } from "vitest";
import { PickupDecision, ScreeningVerdict } from "./enums";
import {
  derivePickupDecision,
  pickupInspectionSchema,
  screeningBlocksPickupAcceptance,
} from "./volunteer-pickup-inspection";

const ALL_YES = {
  matchesDescription: true,
  packagingSealedClean: true,
  looksSmellsNormal: true,
};

function parse(body: unknown) {
  return pickupInspectionSchema.safeParse(body);
}

describe("pickupInspectionSchema", () => {
  it("accepts all three answers as yes without a reason", () => {
    const result = parse(ALL_YES);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBeUndefined();
  });

  it("accepts a no answer with a reason", () => {
    expect(
      parse({ ...ALL_YES, looksSmellsNormal: false, reason: "Smells sour" }).success,
    ).toBe(true);
    expect(
      parse({ matchesDescription: false, packagingSealedClean: true, looksSmellsNormal: true, reason: "Wrong food" })
        .success,
    ).toBe(true);
  });

  it("requires a reason when any answer is no", () => {
    expect(parse({ ...ALL_YES, packagingSealedClean: false }).success).toBe(false);
    expect(parse({ ...ALL_YES, looksSmellsNormal: false, reason: "" }).success).toBe(false);
    expect(parse({ ...ALL_YES, looksSmellsNormal: false, reason: "<>" }).success).toBe(false);
  });

  it("refuses a real reason when every answer is yes", () => {
    expect(parse({ ...ALL_YES, reason: "Looks great" }).success).toBe(false);
  });

  it("treats an empty or markup-only reason as no reason, like the donor cancel reason", () => {
    expect(parse({ ...ALL_YES, reason: "" }).success).toBe(true);
    expect(parse({ ...ALL_YES, reason: "<>" }).success).toBe(true);
  });

  it("strips markup from the reason and counts the limit after stripping", () => {
    const result = parse({ ...ALL_YES, looksSmellsNormal: false, reason: "  <Sour>\u0000smell  " });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("Sour smell");

    expect(
      parse({ ...ALL_YES, looksSmellsNormal: false, reason: "x".repeat(500) + "<><>" }).success,
    ).toBe(true);
    expect(
      parse({ ...ALL_YES, looksSmellsNormal: false, reason: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it.each([
    ["a missing answer", { matchesDescription: true, packagingSealedClean: true }],
    ["a non-boolean answer", { ...ALL_YES, looksSmellsNormal: "yes" }],
    ["an extra field", { ...ALL_YES, decision: "ACCEPTED" }],
    ["a client-sent decision", { ...ALL_YES, decision: "REJECTED" }],
    ["a client-sent volunteer id", { ...ALL_YES, volunteerId: "x" }],
    ["a body that is not an object", "all yes"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(parse(value).success).toBe(false);
  });
});

describe("derivePickupDecision", () => {
  it("accepts only when all three answers are yes", () => {
    expect(derivePickupDecision(ALL_YES)).toBe(PickupDecision.ACCEPTED);
    expect(derivePickupDecision({ ...ALL_YES, matchesDescription: false, reason: "Wrong food" })).toBe(
      PickupDecision.REJECTED,
    );
    expect(derivePickupDecision({ ...ALL_YES, packagingSealedClean: false, reason: "Open bag" })).toBe(
      PickupDecision.REJECTED,
    );
    expect(derivePickupDecision({ ...ALL_YES, looksSmellsNormal: false, reason: "Sour" })).toBe(
      PickupDecision.REJECTED,
    );
  });
});

describe("screeningBlocksPickupAcceptance", () => {
  it("blocks accepting on a FLAG verdict", () => {
    expect(screeningBlocksPickupAcceptance(ScreeningVerdict.FLAG)).toBe(true);
  });

  it("lets the volunteer decide on PASS and REVIEW, because the AI is only an aid", () => {
    expect(screeningBlocksPickupAcceptance(ScreeningVerdict.PASS)).toBe(false);
    expect(screeningBlocksPickupAcceptance(ScreeningVerdict.REVIEW)).toBe(false);
  });
});
