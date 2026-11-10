import { describe, expect, it } from "vitest";
import { adminDonationDetailId, adminDonationReportSchema } from "./admin-donation-detail";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

describe("adminDonationDetailId", () => {
  it("accepts a uuid", () => {
    expect(adminDonationDetailId.parse(VALID_ID)).toBe(VALID_ID);
  });

  it("accepts an uppercase uuid and normalizes it to lower case", () => {
    expect(adminDonationDetailId.parse(VALID_ID.toUpperCase())).toBe(VALID_ID);
  });

  it.each([
    "abc",
    "",
    "11111111111141118111111111111111",
    "11111111-1111-4111-8111",
    " 11111111-1111-4111-8111-111111111111",
  ])("rejects %j", (value) => {
    expect(adminDonationDetailId.safeParse(value).success).toBe(false);
  });
});

describe("adminDonationReportSchema", () => {
  it("accepts the minimum shape and keeps every extra key unchanged", () => {
    const report = {
      generated_at: "2026-11-09T09:00:00.000Z",
      donation: { id: VALID_ID, status: "POSTED", food_name: "Chicken adobo" },
      donor: { name: "Test Bakery", phone: "+639170000000" },
      distribution: { entries: [{ notes: "Handled with care" }], unusable: [] },
    };

    const parsed = adminDonationReportSchema.parse(report);

    expect(parsed).toEqual(report);
  });

  it.each([
    ["not an object", "report"],
    ["null", null],
    ["an array", []],
    ["no donation key", { generated_at: "2026-11-09T09:00:00.000Z" }],
    ["a null donation", { donation: null }],
    ["no status", { donation: { id: VALID_ID } }],
    ["a non-string status", { donation: { id: VALID_ID, status: 7 } }],
    ["an id that is not a uuid", { donation: { id: "not-a-uuid", status: "POSTED" } }],
  ])("rejects %s", (_label, value) => {
    expect(adminDonationReportSchema.safeParse(value).success).toBe(false);
  });
});
