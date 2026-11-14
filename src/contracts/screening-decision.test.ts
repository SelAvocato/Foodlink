import { describe, expect, it } from "vitest";
import { screeningDecisionSchema } from "./screening-decision";

describe("screeningDecisionSchema", () => {
  it("accepts PASS without a reason and REJECT with one", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "PASS" }).success).toBe(true);
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "Blurry photo" }).success).toBe(true);
  });

  it("strips markup from the reason", () => {
    const result = screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "  <Blurry> \u0000photo  " });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe("Blurry photo");
  });

  it("rejects a reason that is only markup", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "<>" }).success).toBe(false);
  });

  it("counts the length limit after stripping", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "x".repeat(500) + "<><>" }).success).toBe(
      true,
    );
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "x".repeat(501) }).success).toBe(false);
  });

  it("still refuses a reason sent with PASS", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "PASS", reason: "Anything" }).success).toBe(false);
    expect(screeningDecisionSchema.safeParse({ decision: "PASS", reason: "<>" }).success).toBe(false);
  });

  it("rejects an unknown decision and unknown fields", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "MAYBE" }).success).toBe(false);
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "x", screeningId: "y" }).success).toBe(
      false,
    );
  });
});
