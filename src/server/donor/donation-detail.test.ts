import { describe, expect, it } from "vitest";
import type { DonorDonationDetailStore } from "./donation-detail";
import { getDonorDonationDetail } from "./donation-detail";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "donor-1";

class FakeDetailStore implements DonorDonationDetailStore {
  report: unknown = null;
  calls: [string, string][] = [];

  async findReport(donationId: string, donorId: string): Promise<unknown> {
    this.calls.push([donationId, donorId]);
    return this.report;
  }
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-11-13T09:00:00.000Z",
    donation: { id: DONATION_ID, food_name: "Chicken adobo", status: "POSTED" },
    donor: { name: "Test Bakery", donor_type: "ESTABLISHMENT" },
    volunteer: { first_name: "Ana", phone: "+639171111111" },
    timeline: [],
    ...overrides,
  };
}

describe("getDonorDonationDetail", () => {
  it("returns the report and sends the donation id and the donor id to the store", async () => {
    const store = new FakeDetailStore();
    store.report = report();

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(store.calls).toEqual([[DONATION_ID, DONOR_ID]]);
    expect(result).toEqual({ ok: true, report: report() });
    // A report that never had the two Admin-only keys comes back exactly as before.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report).not.toHaveProperty("assignments");
      expect(result.report).not.toHaveProperty("incidents");
    }
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("answers NOT_FOUND when the store returns %s", async (_label, value) => {
    const store = new FakeDetailStore();
    store.report = value;

    expect(await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID })).toEqual({
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

    await expect(
      getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID }),
    ).rejects.toThrow("The donation report has an unexpected shape.");
  });

  it("removes note and metadata from every timeline entry and keeps type, from, to, at", async () => {
    const store = new FakeDetailStore();
    store.report = report({
      timeline: [
        {
          type: "POSTED",
          from: "SCREENED",
          to: "POSTED",
          at: "2026-11-13T08:00:00.000Z",
          note: "internal admin note",
          metadata: { volunteerId: "volunteer-1" },
        },
        {
          type: "ASSIGNED",
          from: "ACCEPTED",
          to: "ASSIGNED",
          at: "2026-11-13T09:00:00.000Z",
          note: null,
          metadata: null,
        },
      ],
    });

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.timeline).toEqual([
        { type: "POSTED", from: "SCREENED", to: "POSTED", at: "2026-11-13T08:00:00.000Z" },
        { type: "ASSIGNED", from: "ACCEPTED", to: "ASSIGNED", at: "2026-11-13T09:00:00.000Z" },
      ]);
      const returned = JSON.stringify(result.report);
      expect(returned).not.toContain("internal admin note");
      expect(returned).not.toContain("volunteerId");
    }
  });

  it("removes assignments and incidents even when the function returns them", async () => {
    const store = new FakeDetailStore();
    // What the report would look like if the function stopped gating both by role.
    store.report = report({
      assignments: [
        { volunteer_name: "Ana Cruz", assigned_at: "2026-11-13T09:30:00.000Z", ended_at: null },
      ],
      incidents: [
        { id: "incident-1", title: "Broken container", reported_at: "2026-11-13T10:00:00.000Z" },
      ],
    });

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report).not.toHaveProperty("assignments");
      expect(result.report).not.toHaveProperty("incidents");
      const returned = JSON.stringify(result.report);
      for (const secret of ["Ana Cruz", "incident-1", "Broken container", "assignments", "incidents"]) {
        expect(returned).not.toContain(secret);
      }
    }
  });

  it("removes assignments and incidents when the function returns them as null", async () => {
    const store = new FakeDetailStore();
    store.report = report({ assignments: null, incidents: null });

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report).not.toHaveProperty("assignments");
      expect(result.report).not.toHaveProperty("incidents");
    }
  });

  it("keeps every other report key unchanged", async () => {
    const store = new FakeDetailStore();
    const stored = report({
      pickup: {
        address: "12 Mabini St, Quezon City",
        pickup_start: "2026-11-14T08:00:00.000Z",
        pickup_end: "2026-11-14T10:00:00.000Z",
      },
      distribution: { entries: [{ notes: "Handled with care" }], unusable: [] },
      impact: { portions_donated: 25, portions_distributed: 25, portions_unusable: 0, people_served: 20 },
      assignments: [{ volunteer_name: "Ana Cruz", assigned_at: "2026-11-13T09:30:00.000Z" }],
      incidents: [{ id: "incident-1", title: "Broken container" }],
      timeline: [
        { type: "POSTED", from: "SCREENED", to: "POSTED", at: "2026-11-13T08:00:00.000Z", note: "hidden" },
      ],
    });
    store.report = stored;

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    // Everything survives except the two Admin-only keys and the timeline's note.
    const expected: Record<string, unknown> = { ...stored };
    delete expected.assignments;
    delete expected.incidents;
    expected.timeline = [
      { type: "POSTED", from: "SCREENED", to: "POSTED", at: "2026-11-13T08:00:00.000Z" },
    ];

    expect(result).toEqual({ ok: true, report: expected });
  });

  it("returns a report without a timeline unchanged", async () => {
    const store = new FakeDetailStore();
    const stored = {
      generated_at: "2026-11-13T09:00:00.000Z",
      donation: { id: DONATION_ID, food_name: "Chicken adobo", status: "POSTED" },
      donor: { name: "Test Bakery", donor_type: "ESTABLISHMENT" },
    };
    store.report = stored;

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(result).toEqual({ ok: true, report: stored });
  });

  it("leaves a timeline that is not an array untouched", async () => {
    const store = new FakeDetailStore();
    const stored = report({ timeline: "not-an-array" });
    store.report = stored;

    const result = await getDonorDonationDetail({ store }, { donationId: DONATION_ID, donorId: DONOR_ID });

    expect(result).toEqual({ ok: true, report: stored });
  });
});
