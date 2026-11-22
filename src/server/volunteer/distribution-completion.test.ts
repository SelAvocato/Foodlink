import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  completeDistribution,
  type DistributionCompletionStore,
  type DistributionCompletionTotals,
  type DistributionCompletionTransition,
} from "./distribution-completion";
import type { DistributionDonation } from "./distribution-entries";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const CLOSED_AT = new Date("2026-11-18T10:00:00.000Z");

function donation(overrides: Partial<DistributionDonation> = {}): DistributionDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.DELIVERED,
    deletedAt: null,
    portions: 20,
    ...overrides,
  };
}

class FakeStore implements DistributionCompletionStore {
  donationRow: DistributionDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  totals: DistributionCompletionTotals = { entries: 1, distributed: 18, unusable: 2 };

  async readDonation(): Promise<DistributionDonation | null> {
    return this.donationRow;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async getCompletionTotals(): Promise<DistributionCompletionTotals> {
    return this.totals;
  }
}

function fakeTransition(
  result: Awaited<ReturnType<DistributionCompletionTransition>> = {
    ok: true,
    closedAt: CLOSED_AT,
  },
) {
  const calls: { donationId: string; volunteerId: string }[] = [];
  return {
    calls,
    fn: async (input: { donationId: string; volunteerId: string }) => {
      calls.push(input);
      return result;
    },
  };
}

function complete(store: FakeStore, transition = fakeTransition()) {
  return completeDistribution(
    { store, transition: transition.fn },
    { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
  );
}

describe("completeDistribution", () => {
  it("closes a reconciled donation and returns its progress", async () => {
    const store = new FakeStore();
    const transition = fakeTransition();

    const result = await complete(store, transition);

    expect(result).toEqual({
      ok: true,
      status: DonationStatus.CLOSED,
      closedAt: CLOSED_AT,
      progress: { accountedPortions: 20, totalPortions: 20, remainingPortions: 0 },
    });
    expect(transition.calls).toEqual([
      { donationId: DONATION_ID, volunteerId: VOLUNTEER_ID },
    ]);
  });

  it("refuses closing without a distribution entry", async () => {
    const store = new FakeStore();
    store.totals = { entries: 0, distributed: 0, unusable: 0 };
    const transition = fakeTransition();

    expect(await complete(store, transition)).toEqual({
      ok: false,
      error: "RECONCILIATION_INCOMPLETE",
    });
    expect(transition.calls).toEqual([]);
  });

  it.each([
    { entries: 1, distributed: 17, unusable: 2 },
    { entries: 1, distributed: 18, unusable: 3 },
  ])("refuses closing when the totals do not reconcile (%o)", async (totals) => {
    const store = new FakeStore();
    store.totals = totals;
    const transition = fakeTransition();

    expect(await complete(store, transition)).toEqual({
      ok: false,
      error: "RECONCILIATION_INCOMPLETE",
    });
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_FOUND for a missing, deleted or foreign donation", async () => {
    const missing = new FakeStore();
    missing.donationRow = null;
    expect(await complete(missing)).toEqual({ ok: false, error: "NOT_FOUND" });

    const deleted = new FakeStore();
    deleted.donationRow = donation({ deletedAt: new Date() });
    expect(await complete(deleted)).toEqual({ ok: false, error: "NOT_FOUND" });

    const foreign = new FakeStore();
    foreign.currentVolunteerId = OTHER_VOLUNTEER_ID;
    expect(await complete(foreign)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("refuses a donation that is not DELIVERED", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.CLOSED });
    const transition = fakeTransition();

    expect(await complete(store, transition)).toEqual({
      ok: false,
      error: "INVALID_STATE",
    });
    expect(transition.calls).toEqual([]);
  });

  it.each(["NOT_FOUND", "INVALID_STATE", "RECONCILIATION_INCOMPLETE"] as const)(
    "passes a %s refusal from the transition through",
    async (error) => {
      const store = new FakeStore();
      const transition = fakeTransition({ ok: false, error });

      expect(await complete(store, transition)).toEqual({ ok: false, error });
    },
  );

  it("rethrows an unexpected transition failure", async () => {
    const store = new FakeStore();
    const boom = new Error("database is down");

    await expect(
      completeDistribution(
        { store, transition: async () => Promise.reject(boom) },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
      ),
    ).rejects.toBe(boom);
  });
});
