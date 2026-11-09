import { describe, expect, it } from "vitest";
import { postDonationSchema } from "./donation-post";

describe("postDonationSchema", () => {
  it("accepts exactly { confirmed: true }", () => {
    const result = postDonationSchema.safeParse({ confirmed: true });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ confirmed: true });
  });

  it("rejects confirmed false or a missing confirmation", () => {
    expect(postDonationSchema.safeParse({ confirmed: false }).success).toBe(false);
    expect(postDonationSchema.safeParse({}).success).toBe(false);
  });

  it("rejects other truthy values for confirmed", () => {
    expect(postDonationSchema.safeParse({ confirmed: "true" }).success).toBe(false);
    expect(postDonationSchema.safeParse({ confirmed: 1 }).success).toBe(false);
  });

  it("rejects unknown fields such as donorId, donationId or qrToken", () => {
    expect(postDonationSchema.safeParse({ confirmed: true, donorId: "someone-else" }).success).toBe(false);
    expect(postDonationSchema.safeParse({ confirmed: true, donationId: "x" }).success).toBe(false);
    expect(postDonationSchema.safeParse({ confirmed: true, qrToken: "leak" }).success).toBe(false);
  });
});
