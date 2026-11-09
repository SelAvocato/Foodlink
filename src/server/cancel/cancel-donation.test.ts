import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  cancelDonation,
  type CancelDonationResult,
  type CancelDonationRow,
  type CancelStore,
  type CancelTransition,
} from "./cancel-donation";

const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const DONATION_ID = "donation-1";

class FakeCancelStore implements CancelStore {
  rows = new Map<string, CancelDonationRow>();
  reads: string[] = [];

  async readDonation(donationId: string): Promise<CancelDonationRow | null> {
    this.reads.push(donationId);
    return this.rows.get(donationId) ?? null;
  }
}

class FakeTransition {
  calls: { donationId: string; donorId: string; reason?: string }[] = [];
  result: { ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" } = { ok: true };

  readonly run: CancelTransition = (input) => {
    this.calls.push({ ...input });
    return Promise.resolve(this.result);
  };
}

function seedRow(overrides: Partial<CancelDonationRow> = {}): CancelDonationRow {
  return {
    donorId: DONOR_ID,
    status: DonationStatus.POSTED,
    deletedAt: null,
    ...overrides,
  };
}

function setup(row: CancelDonationRow | null) {
  const store = new FakeCancelStore();
  if (row) store.rows.set(DONATION_ID, row);
  const transition = new FakeTransition();
  return { store, transition };
}

type Deps = ReturnType<typeof setup>;

function cancel(deps: Deps, reason?: string): Promise<CancelDonationResult> {
  return cancelDonation(
    { store: deps.store, transition: deps.transition.run },
    { donorId: DONOR_ID, donationId: DONATION_ID, ...(reason === undefined ? {} : { reason }) },
  );
}

/** A refusal must never reach the transition. */
function expectNoTransition(deps: Deps): void {
  expect(deps.transition.calls).toEqual([]);
}

describe("cancelDonation", () => {
  it.each([DonationStatus.POSTED, DonationStatus.ACCEPTED])(
    "cancels a %s donation without a reason",
    async (status) => {
      const deps = setup(seedRow({ status }));

      const result = await cancel(deps);

      expect(result).toEqual({ ok: true, donationId: DONATION_ID, status: "CANCELLED" });
      expect(deps.store.reads).toEqual([DONATION_ID]);
      expect(deps.transition.calls).toEqual([{ donationId: DONATION_ID, donorId: DONOR_ID }]);
    },
  );

  it("passes a reason through trimmed", async () => {
    const deps = setup(seedRow({ status: DonationStatus.ACCEPTED }));

    const result = await cancel(deps, "  Too many portions  ");

    expect(result).toEqual({ ok: true, donationId: DONATION_ID, status: "CANCELLED" });
    expect(deps.transition.calls).toEqual([
      { donationId: DONATION_ID, donorId: DONOR_ID, reason: "Too many portions" },
    ]);
  });

  it("omits a reason that is empty after trimming", async () => {
    const deps = setup(seedRow());

    const result = await cancel(deps, "   ");

    expect(result).toEqual({ ok: true, donationId: DONATION_ID, status: "CANCELLED" });
    expect(deps.transition.calls).toEqual([{ donationId: DONATION_ID, donorId: DONOR_ID }]);
    expect(deps.transition.calls[0]).not.toHaveProperty("reason");
  });

  it.each([
    DonationStatus.ASSIGNED,
    DonationStatus.PICKED_UP,
    DonationStatus.DRAFT,
    DonationStatus.SCREENED,
    DonationStatus.CANCELLED,
    DonationStatus.CLOSED,
  ])("answers NOT_CANCELLABLE for a %s donation and never calls the transition", async (status) => {
    const deps = setup(seedRow({ status }));

    const result = await cancel(deps);

    expect(result).toEqual({ ok: false, error: "NOT_CANCELLABLE" });
    expectNoTransition(deps);
  });

  it.each([
    ["missing", null],
    ["deleted", seedRow({ deletedAt: new Date("2026-11-09T00:00:00.000Z") })],
    ["another donor's", seedRow({ donorId: OTHER_DONOR_ID })],
  ])("answers NOT_FOUND for a %s donation and never calls the transition", async (_label, row) => {
    const deps = setup(row);

    const result = await cancel(deps);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expectNoTransition(deps);
  });

  it.each([
    ["INVALID_TRANSITION", "NOT_CANCELLABLE"],
    ["FORBIDDEN_ACTOR", "NOT_CANCELLABLE"],
    ["NOT_FOUND", "NOT_FOUND"],
  ] as const)("maps a transition %s to %s", async (from, to) => {
    const deps = setup(seedRow());
    deps.transition.result = { ok: false, error: from };

    const result = await cancel(deps);

    expect(result).toEqual({ ok: false, error: to });
    // The transition was reached with the reason omitted and refused.
    expect(deps.transition.calls).toEqual([{ donationId: DONATION_ID, donorId: DONOR_ID }]);
  });
});
