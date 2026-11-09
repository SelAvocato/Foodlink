import { describe, expect, it } from "vitest";
import { cancelDonationSchema } from "./donation-cancel";

describe("cancelDonationSchema", () => {
  it("accepts an empty body object (a cancel without a reason)", () => {
    const result = cancelDonationSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({});
  });

  it("accepts a reason and trims it", () => {
    const result = cancelDonationSchema.safeParse({ reason: "  Too many portions  " });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ reason: "Too many portions" });
  });

  it("turns an empty or whitespace-only reason into undefined", () => {
    const empty = cancelDonationSchema.safeParse({ reason: "" });
    const spaces = cancelDonationSchema.safeParse({ reason: "   " });

    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.reason).toBeUndefined();
    expect(spaces.success).toBe(true);
    if (spaces.success) expect(spaces.data.reason).toBeUndefined();
  });

  it("rejects a reason over 500 characters", () => {
    expect(cancelDonationSchema.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(cancelDonationSchema.safeParse({ reason: "x".repeat(500) }).success).toBe(true);
  });

  it("rejects unknown fields such as donationId, donorId or qrToken", () => {
    expect(cancelDonationSchema.safeParse({ reason: "ok", donationId: "x" }).success).toBe(false);
    expect(cancelDonationSchema.safeParse({ donorId: "someone-else" }).success).toBe(false);
    expect(cancelDonationSchema.safeParse({ qrToken: "leak" }).success).toBe(false);
  });
});
