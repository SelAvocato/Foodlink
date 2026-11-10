import { describe, expect, it } from "vitest";
import type { AdminDonationDetailStore } from "./donation-detail";
import { getAdminDonationDetail } from "./donation-detail";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";

class FakeDetailStore implements AdminDonationDetailStore {
  report: unknown = null;
  calls: string[] = [];

  async findReport(donationId: string): Promise<unknown> {
    this.calls.push(donationId);
    return this.report;
  }
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-11-09T09:00:00.000Z",
    donation: { id: DONATION_ID, food_name: "Chicken adobo", status: "POSTED" },
    donor: { name: "Test Bakery", phone: "+639170000000" },
    ...overrides,
  };
}

describe("getAdminDonationDetail", () => {
  it("returns the report and sends the donation id to the store", async () => {
    const store = new FakeDetailStore();
    store.report = report();

    const result = await getAdminDonationDetail({ store }, { donationId: DONATION_ID });

    expect(store.calls).toEqual([DONATION_ID]);
    expect(result).toEqual({ ok: true, report: report() });
  });

  it("returns the report with extra keys unchanged", async () => {
    const store = new FakeDetailStore();
    const stored = report({
      volunteer: { user_id: "volunteer-1", name: "Ana Cruz", phone: "+639171111111" },
      distribution: { entries: [{ notes: "Handled with care" }], unusable: [] },
      timeline: [{ type: "POSTED", at: "2026-11-09T09:00:00.000Z" }],
    });
    store.report = stored;

    const result = await getAdminDonationDetail({ store }, { donationId: DONATION_ID });

    expect(result).toEqual({ ok: true, report: stored });
    if (result.ok) expect(result.report).toEqual(stored);
  });

  it("answers NOT_FOUND when the function returns no row", async () => {
    const store = new FakeDetailStore();
    store.report = null;

    expect(await getAdminDonationDetail({ store }, { donationId: DONATION_ID })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("answers NOT_FOUND when the store returns nothing at all", async () => {
    const store = new FakeDetailStore();
    store.report = undefined;

    expect(await getAdminDonationDetail({ store }, { donationId: DONATION_ID })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it.each([
    ["a string", "not a report"],
    ["an array", []],
    ["no donation key", { donor: { name: "Test Bakery" } }],
    ["no status", { donation: { id: DONATION_ID } }],
    ["a non-string status", { donation: { id: DONATION_ID, status: 7 } }],
    [
      "a report for a different donation",
      { donation: { id: "22222222-2222-4222-8222-222222222222", status: "POSTED" } },
    ],
  ])("throws for a malformed report: %s", async (_label, malformed) => {
    const store = new FakeDetailStore();
    store.report = malformed;

    await expect(getAdminDonationDetail({ store }, { donationId: DONATION_ID })).rejects.toThrow(
      "The donation report has an unexpected shape.",
    );
  });
});
