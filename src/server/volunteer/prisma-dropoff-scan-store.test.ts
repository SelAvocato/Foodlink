import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: { $transaction: mocks.transaction } }));

import { prismaDropoffScanStore } from "./prisma-dropoff-scan-store";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const SCANNED_AT = new Date("2026-11-18T09:30:00.000Z");

const insertedRow = {
  scanned_at: SCANNED_AT,
  scanned_by_user_id: VOLUNTEER_ID,
  inserted: true,
};

const existingRow = {
  scanned_at: SCANNED_AT,
  scanned_by_user_id: VOLUNTEER_ID,
  inserted: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (work: (tx: { $queryRaw: typeof mocks.queryRaw }) => Promise<unknown>) =>
      work({ $queryRaw: mocks.queryRaw }),
  );
});

describe("prismaDropoffScanStore.recordScan", () => {
  it("locks the donation, inserts the scan and returns it", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: DONATION_ID }])
      .mockResolvedValueOnce([insertedRow]);

    const result = await prismaDropoffScanStore.recordScan({
      donationId: DONATION_ID,
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toEqual({
      inserted: true,
      scannedAt: SCANNED_AT,
      scannedByUserId: VOLUNTEER_ID,
    });
    // Lock, insert; no fallback read when the insert won.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("reads the winner's row in a separate statement when the insert conflicts", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: DONATION_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existingRow]);

    const result = await prismaDropoffScanStore.recordScan({
      donationId: DONATION_ID,
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toEqual({
      inserted: false,
      scannedAt: SCANNED_AT,
      scannedByUserId: VOLUNTEER_ID,
    });
    // The third call is the fresh-snapshot read after ON CONFLICT DO NOTHING.
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });

  it("returns the conflicting row even when another volunteer wrote it", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: DONATION_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...existingRow, scanned_by_user_id: OTHER_VOLUNTEER_ID }]);

    const result = await prismaDropoffScanStore.recordScan({
      donationId: DONATION_ID,
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toMatchObject({ inserted: false, scannedByUserId: OTHER_VOLUNTEER_ID });
  });

  it("returns null without inserting when the donation is no longer picked up or was deleted", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    const result = await prismaDropoffScanStore.recordScan({
      donationId: DONATION_ID,
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns null when the insert is skipped and no existing row is found", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: DONATION_ID }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await prismaDropoffScanStore.recordScan({
      donationId: DONATION_ID,
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toBeNull();
  });

  it("rejects malformed ids before touching the database", async () => {
    const result = await prismaDropoffScanStore.recordScan({
      donationId: "not-a-uuid",
      scannedByUserId: VOLUNTEER_ID,
    });

    expect(result).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
