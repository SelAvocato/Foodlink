import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import { getQrLabel, type GetQrLabelResult, type QrLabelRow, type QrStore } from "./get-qr-label";

const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const DONATION_ID = "donation-1";
const QR_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

class FakeQrStore implements QrStore {
  rows = new Map<string, QrLabelRow>();
  reads: string[] = [];

  async readQrLabel(donationId: string): Promise<QrLabelRow | null> {
    this.reads.push(donationId);
    return this.rows.get(donationId) ?? null;
  }
}

function seedRow(overrides: Partial<QrLabelRow> = {}): QrLabelRow {
  return {
    donorId: DONOR_ID,
    status: DonationStatus.POSTED,
    deletedAt: null,
    qrToken: QR_TOKEN,
    ...overrides,
  };
}

function setup(row: QrLabelRow | null) {
  const store = new FakeQrStore();
  if (row) store.rows.set(DONATION_ID, row);
  return store;
}

function read(store: QrStore, donorId = DONOR_ID): Promise<GetQrLabelResult> {
  return getQrLabel({ store }, { donorId, donationId: DONATION_ID });
}

describe("getQrLabel", () => {
  it.each([DonationStatus.POSTED, DonationStatus.ACCEPTED, DonationStatus.ASSIGNED])(
    "returns the token for a %s donation of the owner",
    async (status) => {
      const store = setup(seedRow({ status }));

      const result = await read(store);

      expect(result).toEqual({
        ok: true,
        donationId: DONATION_ID,
        status,
        qrToken: QR_TOKEN,
      });
      expect(store.reads).toEqual([DONATION_ID]);
    },
  );

  it.each([
    DonationStatus.DRAFT,
    DonationStatus.SCREENED,
    DonationStatus.PICKED_UP,
    DonationStatus.CANCELLED,
    DonationStatus.EXPIRED,
  ])("answers NOT_AVAILABLE for a %s donation", async (status) => {
    const store = setup(seedRow({ status }));

    const result = await read(store);

    expect(result).toEqual({ ok: false, error: "NOT_AVAILABLE" });
  });

  it("answers NOT_AVAILABLE for a visible status without a token", async () => {
    const store = setup(seedRow({ qrToken: null }));

    const result = await read(store);

    expect(result).toEqual({ ok: false, error: "NOT_AVAILABLE" });
  });

  it.each([
    ["missing", null],
    ["deleted", seedRow({ deletedAt: new Date("2026-11-09T00:00:00.000Z") })],
    ["another donor's", seedRow({ donorId: OTHER_DONOR_ID })],
  ])("answers NOT_FOUND for a %s donation", async (_label, row) => {
    const store = setup(row);

    const result = await read(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
