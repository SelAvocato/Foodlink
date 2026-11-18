import { describe, expect, it } from "vitest";
import { DonationStatus, QrScanStage } from "@/contracts/enums";
import {
  recordDropoffScan,
  type DropoffScanDonation,
  type DropoffScanRow,
  type DropoffScanStore,
  type DropoffTransition,
  type RecordedDropoffScan,
} from "./dropoff-scan";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DONATION_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";
const SCANNED_AT = new Date("2026-11-18T09:30:00.000Z");

function donation(overrides: Partial<DropoffScanDonation> = {}): DropoffScanDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.PICKED_UP,
    deletedAt: null,
    ...overrides,
  };
}

class FakeStore implements DropoffScanStore {
  donationRow: DropoffScanDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  scanRow: DropoffScanRow | null = null;
  recordResult: RecordedDropoffScan | null | undefined = undefined;
  recordCalls: { donationId: string; scannedByUserId: string }[] = [];

  async findByQrToken(): Promise<DropoffScanDonation | null> {
    return this.donationRow;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async findScan(): Promise<DropoffScanRow | null> {
    return this.scanRow;
  }

  async recordScan(input: {
    donationId: string;
    scannedByUserId: string;
  }): Promise<RecordedDropoffScan | null> {
    this.recordCalls.push(input);
    if (this.recordResult !== undefined) return this.recordResult;
    return { inserted: true, scannedAt: SCANNED_AT, scannedByUserId: VOLUNTEER_ID };
  }
}

type FakeTransition = {
  fn: DropoffTransition;
  calls: { donationId: string; volunteerId: string }[];
};

function fakeTransition(
  result: Awaited<ReturnType<DropoffTransition>> = { ok: true },
): FakeTransition {
  const calls: { donationId: string; volunteerId: string }[] = [];
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
      return result;
    },
  };
}

function scan(
  store: DropoffScanStore,
  transition: DropoffTransition = fakeTransition().fn,
  volunteerId = VOLUNTEER_ID,
) {
  return recordDropoffScan(
    { store, transition },
    { volunteerId, donationId: DONATION_ID, token: TOKEN },
  );
}

describe("recordDropoffScan", () => {
  it("records the scan and delivers a picked-up donation", async () => {
    const store = new FakeStore();
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({
      ok: true,
      response: {
        stage: QrScanStage.DROPOFF,
        status: DonationStatus.DELIVERED,
        scannedAt: SCANNED_AT,
        alreadyScanned: false,
      },
    });
    expect(store.recordCalls).toEqual([
      { donationId: DONATION_ID, scannedByUserId: VOLUNTEER_ID },
    ]);
    expect(transition.calls).toEqual([{ donationId: DONATION_ID, volunteerId: VOLUNTEER_ID }]);
  });

  it("marks an existing scan as already scanned but still delivers", async () => {
    const store = new FakeStore();
    store.recordResult = {
      inserted: false,
      scannedAt: SCANNED_AT,
      scannedByUserId: VOLUNTEER_ID,
    };
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toMatchObject({ ok: true, response: { alreadyScanned: true } });
    expect(transition.calls).toHaveLength(1);
  });

  it("answers a repeat after delivery with the original scan and no second transition", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.DELIVERED });
    store.scanRow = { scannedAt: SCANNED_AT, scannedByUserId: VOLUNTEER_ID };
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({
      ok: true,
      response: {
        stage: QrScanStage.DROPOFF,
        status: DonationStatus.DELIVERED,
        scannedAt: SCANNED_AT,
        alreadyScanned: true,
      },
    });
    expect(store.recordCalls).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("refuses a delivered donation with no drop-off scan on record", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.DELIVERED });
    store.scanRow = null;

    expect(await scan(store)).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("answers NOT_FOUND for an unknown token, another donation's token or a deleted donation", async () => {
    const missing = new FakeStore();
    missing.donationRow = null;
    expect(await scan(missing)).toEqual({ ok: false, error: "NOT_FOUND" });

    const other = new FakeStore();
    other.donationRow = donation({ id: OTHER_DONATION_ID });
    expect(await scan(other)).toEqual({ ok: false, error: "NOT_FOUND" });

    const deleted = new FakeStore();
    deleted.donationRow = donation({ deletedAt: new Date("2026-11-18T08:00:00.000Z") });
    expect(await scan(deleted)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("answers NOT_FOUND to a volunteer without the current assignment, before the status", async () => {
    const store = new FakeStore();
    store.currentVolunteerId = OTHER_VOLUNTEER_ID;
    store.donationRow = donation({ status: DonationStatus.CLOSED });
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.recordCalls).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it.each([
    DonationStatus.ASSIGNED,
    DonationStatus.DELIVERED,
    DonationStatus.CLOSED,
    DonationStatus.CANCELLED,
    DonationStatus.REJECTED_AT_PICKUP,
  ])("refuses a donation in %s without recording a scan", async (status) => {
    const store = new FakeStore();
    store.donationRow = donation({ status });
    store.scanRow = status === DonationStatus.DELIVERED ? null : store.scanRow;
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(store.recordCalls).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("refuses when the scan insert finds no row because the status changed first", async () => {
    const store = new FakeStore();
    store.recordResult = null;
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(transition.calls).toEqual([]);
  });

  it("refuses a DROPOFF row recorded by another volunteer", async () => {
    const store = new FakeStore();
    store.recordResult = {
      inserted: false,
      scannedAt: SCANNED_AT,
      scannedByUserId: OTHER_VOLUNTEER_ID,
    };
    const transition = fakeTransition();

    const result = await scan(store, transition.fn);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(transition.calls).toEqual([]);
  });

  it.each(["NOT_FOUND", "INVALID_STATE"] as const)(
    "passes a %s refusal from the transition through",
    async (error) => {
      const store = new FakeStore();
      const transition = fakeTransition({ ok: false, error });

      expect(await scan(store, transition.fn)).toEqual({ ok: false, error });
    },
  );

  it("rethrows an unexpected transition failure instead of hiding it", async () => {
    const store = new FakeStore();
    const boom = new Error("database is down");

    await expect(
      scan(store, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});
