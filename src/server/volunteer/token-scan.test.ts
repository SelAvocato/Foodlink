import { describe, expect, it, vi } from "vitest";
import { DonationStatus, QrScanStage } from "@/contracts/enums";
import type { PickupScanDonation, PickupScanStore, RecordedScan } from "./pickup-scan";
import { resolvePickupScan } from "./token-scan";

const NOW = new Date("2026-11-17T09:00:00.000Z");
const DONATION_ID = "11111111-1111-4111-8111-111111111111";
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

function run(store: PickupScanStore, overrides: { token?: string; volunteerId?: string } = {}) {
  return resolvePickupScan(
    { store, now: () => NOW },
    {
      volunteerId: overrides.volunteerId ?? VOLUNTEER_ID,
      token: overrides.token ?? TOKEN,
    },
  );
}

describe("resolvePickupScan", () => {
  it("records the PICKUP scan and points an ASSIGNED donation at the inspection", async () => {
    const { store, findByQrToken, recordScan } = fakeStore();

    const result = await run(store);

    expect(result).toEqual({
      ok: true,
      response: {
        donationId: DONATION_ID,
        status: "ASSIGNED",
        nextStep: "INSPECTION",
        scannedAt: SCANNED_AT,
        alreadyScanned: false,
      },
    });
    // The resolver looks the token up once itself and recordPickupScan looks it
    // up again, which is why the shared pickup rules stay reused as-is.
    expect(findByQrToken).toHaveBeenCalledTimes(2);
    expect(findByQrToken).toHaveBeenCalledWith(TOKEN);
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
      response: {
        donationId: DONATION_ID,
        status: "ASSIGNED",
        nextStep: "INSPECTION",
        scannedAt: SCANNED_AT,
        alreadyScanned: true,
      },
    });
  });

  it("answers NOT_FOUND for an unknown token and records nothing", async () => {
    const { store, recordScan } = fakeStore({ donation: null });

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
  ])("answers NOT_FOUND for %s and records nothing", async (_label, currentVolunteerId) => {
    const { store, recordScan } = fakeStore({ currentVolunteerId });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("hides the donation state from a volunteer who is not assigned", async () => {
    const { store } = fakeStore({
      donation: donation({ status: DonationStatus.PICKED_UP }),
      currentVolunteerId: OTHER_VOLUNTEER_ID,
    });

    // Assignment is checked first, so this is NOT_FOUND, not a drop-off answer.
    expect(await run(store)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("points a PICKED_UP donation at the drop-off without recording a scan", async () => {
    const { store, recordScan } = fakeStore({
      donation: donation({ status: DonationStatus.PICKED_UP }),
    });

    const result = await run(store);

    expect(result).toEqual({
      ok: true,
      response: {
        donationId: DONATION_ID,
        status: "PICKED_UP",
        nextStep: "DROPOFF",
        scannedAt: null,
        alreadyScanned: null,
      },
    });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it.each([DonationStatus.DELIVERED, DonationStatus.CANCELLED])(
    "answers INVALID_STATE while the donation is %s",
    async (status) => {
      const { store, recordScan } = fakeStore({ donation: donation({ status }) });

      const result = await run(store);

      expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
      expect(recordScan).not.toHaveBeenCalled();
    },
  );

  it("answers INVALID_STATE at or after the pickup end", async () => {
    const { store, recordScan } = fakeStore({
      donation: donation({ pickupEnd: new Date("2026-11-17T08:30:00.000Z") }),
    });

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("never returns the token", async () => {
    const { store } = fakeStore();

    const result = await run(store);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
