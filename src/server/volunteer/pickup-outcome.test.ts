import { describe, expect, it } from "vitest";
import { DonationStatus, PickupDecision, ScreeningVerdict } from "@/contracts/enums";
import {
  FALLBACK_REJECTION_REASON,
  recordPickupOutcome,
  type PickupOutcomeDonation,
  type PickupOutcomeScreening,
  type PickupOutcomeStore,
  type PickupOutcomeTransition,
  type RecordPickupOutcomeInput,
  type StoredPickupInspection,
} from "./pickup-outcome";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const SCREENING_ID = "55555555-5555-4555-8555-555555555555";

function donation(overrides: Partial<PickupOutcomeDonation> = {}): PickupOutcomeDonation {
  return { status: DonationStatus.ASSIGNED, deletedAt: null, ...overrides };
}

function inspection(
  overrides: Partial<StoredPickupInspection> = {},
): StoredPickupInspection {
  return {
    volunteerId: VOLUNTEER_ID,
    decision: PickupDecision.ACCEPTED,
    reason: null,
    screeningId: SCREENING_ID,
    ...overrides,
  };
}

class FakeStore implements PickupOutcomeStore {
  donationRow: PickupOutcomeDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  inspectionRow: StoredPickupInspection | null = inspection();
  screeningRow: PickupOutcomeScreening | null = { verdict: ScreeningVerdict.PASS };
  screeningLookups: string[] = [];
  inspectionLookups = 0;

  async readDonation(): Promise<PickupOutcomeDonation | null> {
    return this.donationRow;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async findInspection(): Promise<StoredPickupInspection | null> {
    this.inspectionLookups += 1;
    return this.inspectionRow;
  }

  async findScreening(screeningId: string): Promise<PickupOutcomeScreening | null> {
    this.screeningLookups.push(screeningId);
    return this.screeningRow;
  }
}

type FakeTransition = {
  fn: PickupOutcomeTransition;
  calls: RecordPickupOutcomeInput[];
};

function fakeTransition(
  result: Awaited<ReturnType<PickupOutcomeTransition>> = { ok: true },
): FakeTransition {
  const calls: RecordPickupOutcomeInput[] = [];
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

function record(
  store: PickupOutcomeStore,
  transition: PickupOutcomeTransition = fakeTransition().fn,
  volunteerId = VOLUNTEER_ID,
) {
  return recordPickupOutcome({ store, transition }, { volunteerId, donationId: DONATION_ID });
}

describe("recordPickupOutcome", () => {
  it("marks an accepted inspection picked up", async () => {
    const transition = fakeTransition();

    const result = await record(new FakeStore(), transition.fn);

    expect(result).toEqual({
      ok: true,
      status: DonationStatus.PICKED_UP,
      decision: PickupDecision.ACCEPTED,
    });
    expect(transition.calls).toEqual([
      {
        donationId: DONATION_ID,
        volunteerId: VOLUNTEER_ID,
        to: DonationStatus.PICKED_UP,
        decision: PickupDecision.ACCEPTED,
      },
    ]);
  });

  it("does not let REVIEW block picking up", async () => {
    const store = new FakeStore();
    store.screeningRow = { verdict: ScreeningVerdict.REVIEW };

    const result = await record(store);

    expect(result).toMatchObject({ ok: true, status: DonationStatus.PICKED_UP });
    expect(store.screeningLookups).toEqual([SCREENING_ID]);
  });

  it("blocks picking up when the inspection's screening is FLAG", async () => {
    const store = new FakeStore();
    store.screeningRow = { verdict: ScreeningVerdict.FLAG };
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "SCREENING_BLOCKED" });
    expect(transition.calls).toEqual([]);
  });

  it("picks up when the inspection has no screening link", async () => {
    const store = new FakeStore();
    store.inspectionRow = inspection({ screeningId: null });

    const result = await record(store);

    expect(result).toMatchObject({ ok: true, status: DonationStatus.PICKED_UP });
    expect(store.screeningLookups).toEqual([]);
  });

  it("picks up when the linked screening row no longer exists", async () => {
    const store = new FakeStore();
    store.screeningRow = null;

    const result = await record(store);

    expect(result).toMatchObject({ ok: true, status: DonationStatus.PICKED_UP });
  });

  it("rejects at pickup with the inspection's reason and screening", async () => {
    const store = new FakeStore();
    store.inspectionRow = inspection({
      decision: PickupDecision.REJECTED,
      reason: "The container was open.",
    });
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({
      ok: true,
      status: DonationStatus.REJECTED_AT_PICKUP,
      decision: PickupDecision.REJECTED,
    });
    expect(transition.calls).toEqual([
      {
        donationId: DONATION_ID,
        volunteerId: VOLUNTEER_ID,
        to: DonationStatus.REJECTED_AT_PICKUP,
        decision: PickupDecision.REJECTED,
        reason: "The container was open.",
        screeningId: SCREENING_ID,
      },
    ]);
    // Refusing needs no screening clearance.
    expect(store.screeningLookups).toEqual([]);
  });

  it("uses the fallback reason for a rejected row that lost its reason", async () => {
    const store = new FakeStore();
    store.inspectionRow = inspection({
      decision: PickupDecision.REJECTED,
      reason: null,
      screeningId: null,
    });
    const transition = fakeTransition();

    await record(store, transition.fn);

    expect(transition.calls[0]).toMatchObject({
      reason: FALLBACK_REJECTION_REASON,
    });
    expect(transition.calls[0]).not.toHaveProperty("screeningId");
  });

  it("asks for the inspection when none was saved", async () => {
    const store = new FakeStore();
    store.inspectionRow = null;
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INSPECTION_REQUIRED" });
    expect(transition.calls).toEqual([]);
  });

  it("treats an inspection saved by another volunteer as missing", async () => {
    const store = new FakeStore();
    store.inspectionRow = inspection({ volunteerId: OTHER_VOLUNTEER_ID });
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INSPECTION_REQUIRED" });
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_FOUND for an unknown or deleted donation", async () => {
    const missing = new FakeStore();
    missing.donationRow = null;
    expect(await record(missing)).toEqual({ ok: false, error: "NOT_FOUND" });

    const deleted = new FakeStore();
    deleted.donationRow = donation({ deletedAt: new Date("2026-11-17T08:00:00.000Z") });
    expect(await record(deleted)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("answers NOT_FOUND to a volunteer without the current assignment, before the status", async () => {
    const store = new FakeStore();
    store.currentVolunteerId = OTHER_VOLUNTEER_ID;
    store.donationRow = donation({ status: DonationStatus.CLOSED });
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.inspectionLookups).toBe(0);
    expect(transition.calls).toEqual([]);
  });

  it.each([
    DonationStatus.PICKED_UP,
    DonationStatus.REJECTED_AT_PICKUP,
    DonationStatus.DELIVERED,
    DonationStatus.CANCELLED,
  ])("refuses a second outcome while %s", async (status) => {
    const store = new FakeStore();
    store.donationRow = donation({ status });
    const transition = fakeTransition();

    const result = await record(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(store.inspectionLookups).toBe(0);
    expect(transition.calls).toEqual([]);
  });

  it.each(["NOT_FOUND", "INVALID_STATE"] as const)(
    "passes a %s refusal from the transition through",
    async (error) => {
      const store = new FakeStore();
      const transition = fakeTransition({ ok: false, error });

      expect(await record(store, transition.fn)).toEqual({ ok: false, error });
    },
  );

  it("rethrows an unexpected transition failure instead of hiding it", async () => {
    const store = new FakeStore();
    const boom = new Error("database is down");

    await expect(
      record(store, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
