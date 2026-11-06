import { describe, expect, it } from "vitest";
import { AccountStatus } from "./enums";
import { resolveReview, reviewSchema, reviewTargetId } from "./review";

describe("reviewSchema", () => {
  it("accepts approve and reactivate with or without a reason", () => {
    expect(reviewSchema.safeParse({ action: "APPROVE" }).success).toBe(true);
    expect(reviewSchema.safeParse({ action: "REACTIVATE", reason: "Resolved" }).success).toBe(true);
  });
  it("treats an empty optional reason as missing", () => {
    expect(reviewSchema.parse({ action: "APPROVE", reason: "  " }).reason).toBeUndefined();
  });
  it("requires a reason to reject or suspend", () => {
    for (const action of ["REJECT", "SUSPEND"]) {
      expect(reviewSchema.safeParse({ action }).success).toBe(false);
      expect(reviewSchema.safeParse({ action, reason: "   " }).success).toBe(false);
      expect(reviewSchema.safeParse({ action, reason: "ID is unreadable" }).success).toBe(true);
    }
  });
  it("trims the reason and limits it to 500 characters", () => {
    expect(reviewSchema.parse({ action: "REJECT", reason: "  blurry ID  " }).reason).toBe("blurry ID");
    expect(reviewSchema.safeParse({ action: "REJECT", reason: "x".repeat(500) }).success).toBe(true);
    expect(reviewSchema.safeParse({ action: "REJECT", reason: "x".repeat(501) }).success).toBe(false);
  });
  it("rejects an unknown action and unknown fields", () => {
    expect(reviewSchema.safeParse({ action: "DELETE" }).success).toBe(false);
    expect(reviewSchema.safeParse({ action: "APPROVE", status: "ACTIVE" }).success).toBe(false);
    expect(reviewSchema.safeParse({ action: "APPROVE", reviewedBy: "someone" }).success).toBe(false);
    expect(reviewSchema.safeParse({ action: "APPROVE", userId: "x" }).success).toBe(false);
  });
});

describe("reviewTargetId", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(reviewTargetId.safeParse("6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11").success).toBe(true);
    expect(reviewTargetId.safeParse("123").success).toBe(false);
  });
});

describe("resolveReview", () => {
  const approve = reviewSchema.parse({ action: "APPROVE" });
  const reject = reviewSchema.parse({ action: "REJECT", reason: "No permit" });
  const suspend = reviewSchema.parse({ action: "SUSPEND", reason: "Incident" });
  const reactivate = reviewSchema.parse({ action: "REACTIVATE" });

  it("moves each action to the right status", () => {
    expect(resolveReview(approve, AccountStatus.PENDING)).toEqual({ ok: true, resultingStatus: "ACTIVE", reason: undefined });
    expect(resolveReview(reject, AccountStatus.PENDING)).toEqual({ ok: true, resultingStatus: "REJECTED", reason: "No permit" });
    expect(resolveReview(suspend, AccountStatus.ACTIVE)).toEqual({ ok: true, resultingStatus: "SUSPENDED", reason: "Incident" });
    expect(resolveReview(reactivate, AccountStatus.SUSPENDED)).toEqual({ ok: true, resultingStatus: "ACTIVE", reason: undefined });
  });
  it("refuses every move from the wrong status", () => {
    const wrong = [
      [approve, AccountStatus.ACTIVE], [approve, AccountStatus.REJECTED], [approve, AccountStatus.SUSPENDED],
      [reject, AccountStatus.ACTIVE], [reject, AccountStatus.REJECTED], [reject, AccountStatus.SUSPENDED],
      [suspend, AccountStatus.PENDING], [suspend, AccountStatus.REJECTED], [suspend, AccountStatus.SUSPENDED],
      [reactivate, AccountStatus.PENDING], [reactivate, AccountStatus.ACTIVE], [reactivate, AccountStatus.REJECTED],
    ] as const;
    for (const [input, status] of wrong) {
      expect(resolveReview(input, status)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    }
  });
});