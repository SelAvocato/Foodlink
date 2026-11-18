import { describe, expect, it, vi } from "vitest";
import { DonationStatus, QrScanStage } from "@/contracts/enums";
import {
  recordPickupScan,
  type PickupScanDonation,
  type PickupScanStore,
  type RecordedScan,
} from "./pickup-scan";

const NOW = new Date("2026-11-17T09:00:00.000Z");
const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DONATION_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";
const SCANNED_AT = new Date("2026-11-17T08:59:00.000Z");
const DELETED_AT = new Date("2026-11-17T08:00:00.000Z");

function donation(overrides: Partial<PickupScanDonation> = {}): PickupScanDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.ASSIGNED,
    pickupEnd: new Date("2026-11-17T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

type FakeOptions = {
  /** undefined: a valid assigned donation. */
  donation?: PickupScanDonation | null;
  /** undefined: the session volunteer is assigned. */
  currentVolunteerId?: string | null;
  /** undefined: a fresh insert. null: there is no row to return. */
  existingScan?: RecordedScan | null;
};

function fakeStore(options: FakeOptions = {}) {
  const findByQrToken = vi.fn<PickupScanStore["findByQrToken"]>(async () =>
    options.donation === undefined ? donation() : options.donation,
  );
  const findCurrentVolunteerId = vi.fn<PickupScanStore["findCurrentVolunteerId"]>(
    async () =>
      options.currentVolunteerId === undefined ? VOLUNTEER_ID : options.currentVolunteerId,
  );
  const recordScan = vi.fn<PickupScanStore["recordScan"]>(async (input) => {
    if (options.existingScan === null) return null;
    if (options.existingScan !== undefined) return options.existingScan;
    return { inserted: true, scannedAt: SCANNED_AT, scannedByUserId: input.scannedByUserId };
  });
  const store: PickupScanStore = { findByQrToken, findCurrentVolunteerId, recordScan };
  return { store, findByQrToken, findCurrentVolunteerId, recordScan };
}

function run(store: PickupScanStore, overrides: { donationId?: string; token?: string } = {}) {
  return recordPickupScan(
    { store, now: () => NOW },
    {
      volunteerId: VOLUNTEER_ID,
      donationId: overrides.donationId ?? DONATION_ID,
      token: overrides.token ?? TOKEN,
    },
  );
}

describe("recordPickupScan", () => {
  it("records a fresh PICKUP scan for the assigned volunteer", async () => {
    const { store, recordScan } = fakeStore();

    const result = await run(store);

    expect(result).toEqual({
      ok: true,
      response: { stage: QrScanStage.PICKUP, scannedAt: SCANNED_AT, alreadyScanned: false },
    });
    expect(recordScan).toHaveBeenCalledExactlyOnceWith({
      donationId: DONATION_ID,
      stage: QrScanStage.PICKUP,
      scannedByUserId: VOLUNTEER_ID,
    });
  });

  it("returns the original time and alreadyScanned on a repeat scan", async () => {
    const { store } = fakeStore({
      existingScan: { inserted: false, scannedAt: SCANNED_AT, scannedByUserId: VOLUNTEER_ID },
    });

    const result = await run(store);

    expect(result).toEqual({
      ok: true,
      response: { stage: QrScanStage.PICKUP, scannedAt: SCANNED_AT, alreadyScanned: true },
    });
  });

  it("answers NOT_FOUND for an unknown token and inserts nothing", async () => {
    const { store, recordScan } = fakeStore({ donation: null });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND when the token belongs to another donation", async () => {
    const { store, recordScan } = fakeStore({ donation: donation({ id: OTHER_DONATION_ID }) });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("answers NOT_FOUND for a discarded donation", async () => {
    const { store, recordScan } = fakeStore({ donation: donation({ deletedAt: DELETED_AT }) });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it.each([
    ["no current assignment", null],
    ["another volunteer's assignment", OTHER_VOLUNTEER_ID],
  ])("answers NOT_FOUND for %s", async (_label, currentVolunteerId) => {
    const { store, recordScan } = fakeStore({ currentVolunteerId });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("hides the donation state from a volunteer who is not assigned", async () => {
    const { store } = fakeStore({
      donation: donation({ status: DonationStatus.POSTED }),
      currentVolunteerId: OTHER_VOLUNTEER_ID,
    });

    // Assignment is checked first, so this is NOT_FOUND, not INVALID_STATE.
    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it.each([
    DonationStatus.DRAFT,
    DonationStatus.SCREENED,
    DonationStatus.POSTED,
    DonationStatus.ACCEPTED,
    DonationStatus.PICKED_UP,
    DonationStatus.DELIVERED,
    DonationStatus.CLOSED,
    DonationStatus.REJECTED_AT_PICKUP,
    DonationStatus.CANCELLED,
    DonationStatus.EXPIRED,
  ])("answers INVALID_STATE while the donation is %s", async (status) => {
    const { store, recordScan } = fakeStore({ donation: donation({ status }) });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it.each([
    ["at the pickup end", new Date(NOW)],
    ["after the pickup end", new Date("2026-11-17T08:30:00.000Z")],
    ["without a pickup end", null],
  ])("answers INVALID_STATE %s", async (_label, pickupEnd) => {
    const { store, recordScan } = fakeStore({ donation: donation({ pickupEnd }) });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("answers INVALID_STATE when the row cannot be inserted or read", async () => {
    const { store } = fakeStore({ existingScan: null });

    expect(await run(store)).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("answers INVALID_STATE when the stage row belongs to another volunteer", async () => {
    const { store } = fakeStore({
      existingScan: { inserted: false, scannedAt: SCANNED_AT, scannedByUserId: OTHER_VOLUNTEER_ID },
    });

    expect(await run(store)).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("never returns the token", async () => {
    const { store } = fakeStore();

    const result = await run(store);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
