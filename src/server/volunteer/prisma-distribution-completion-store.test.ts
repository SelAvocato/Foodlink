import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  transitionDonation: vi.fn(),
  transitionTx: vi.fn(() => "transition-tx"),
  runAchievementEngine: vi.fn(),
  createAchievementStore: vi.fn(() => "achievement-store"),
  readDonation: vi.fn(),
  findCurrentVolunteerId: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: { $transaction: mocks.transaction, $queryRaw: mocks.queryRaw },
}));
vi.mock("@/server/donations/transition-donation", () => {
  class DonationTransitionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "DonationTransitionError";
    }
  }
  return {
    DonationTransitionError,
    createPrismaTransitionTx: mocks.transitionTx,
    transitionDonation: mocks.transitionDonation,
  };
});
vi.mock("./achievement-engine", () => ({
  runAchievementEngine: mocks.runAchievementEngine,
}));
vi.mock("./prisma-achievement-store", () => ({
  createPrismaAchievementStore: mocks.createAchievementStore,
}));
vi.mock("./prisma-distribution-entry-store", () => ({
  prismaDistributionEntryStore: {
    readDonation: mocks.readDonation,
    findCurrentVolunteerId: mocks.findCurrentVolunteerId,
  },
}));

import { DonationTransitionError } from "@/server/donations/transition-donation";
import {
  createDistributionCompletionTransition,
  prismaDistributionCompletionStore,
} from "./prisma-distribution-completion-store";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const CLOSED_AT = new Date("2026-11-18T10:00:00.000Z");

function run() {
  return createDistributionCompletionTransition()({
    donationId: DONATION_ID,
    volunteerId: VOLUNTEER_ID,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transitionTx.mockReturnValue("transition-tx");
  mocks.createAchievementStore.mockReturnValue("achievement-store");
  mocks.transaction.mockImplementation(
    async (work: (tx: { $queryRaw: typeof mocks.queryRaw }) => Promise<unknown>) =>
      work({ $queryRaw: mocks.queryRaw }),
  );
  mocks.queryRaw
    .mockResolvedValueOnce([{ donor_id: DONOR_ID, volunteer_id: VOLUNTEER_ID }])
    .mockResolvedValueOnce([{ closed_at: CLOSED_AT }]);
  mocks.transitionDonation.mockImplementation(
    async (deps: { store: { transaction: (work: () => Promise<unknown>) => Promise<unknown> } }) => {
      await deps.store.transaction(async () => ({ from: "DELIVERED", to: "CLOSED" }));
      return { from: "DELIVERED", to: "CLOSED" };
    },
  );
  mocks.runAchievementEngine.mockResolvedValue({ donorAwards: [], volunteerAwards: [] });
});

describe("createDistributionCompletionTransition", () => {
  it("locks the donation, closes it and runs the achievement engine in the same transaction", async () => {
    const result = await run();

    expect(result).toEqual({ ok: true, closedAt: CLOSED_AT });
    expect(mocks.transitionDonation).toHaveBeenCalledWith(
      expect.objectContaining({ store: expect.anything() }),
      DONATION_ID,
      "CLOSED",
      { id: VOLUNTEER_ID, role: "VOLUNTEER" },
      expect.objectContaining({
        eventNote: "Distribution report completed and reconciled.",
        metadata: { source: "distribution_completion" },
      }),
    );
    expect(mocks.runAchievementEngine).toHaveBeenCalledWith(
      { store: "achievement-store" },
      { donorId: DONOR_ID, volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
    );
  });

  it("falls back to now when the closed row has no closed_at", async () => {
    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ donor_id: DONOR_ID, volunteer_id: VOLUNTEER_ID }])
      .mockResolvedValueOnce([{ closed_at: null }]);

    const result = await run();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.closedAt).toBeInstanceOf(Date);
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["FORBIDDEN_ACTOR", "NOT_FOUND"],
    ["INVALID_TRANSITION", "INVALID_STATE"],
    ["MISSING_PAYLOAD", "RECONCILIATION_INCOMPLETE"],
  ] as const)("maps %s to %s", async (code, expected) => {
    mocks.transitionDonation.mockRejectedValue(
      new DonationTransitionError(code, "transition refused"),
    );

    expect(await run()).toEqual({ ok: false, error: expected });
  });

  it("rethrows an unexpected transition error and an achievement failure", async () => {
    const boom = new Error("database is down");
    mocks.transitionDonation.mockRejectedValue(boom);
    await expect(run()).rejects.toBe(boom);

    mocks.transitionDonation.mockImplementation(
      async (deps: { store: { transaction: (work: () => Promise<unknown>) => Promise<unknown> } }) => {
        await deps.store.transaction(async () => ({ from: "DELIVERED", to: "CLOSED" }));
        return { from: "DELIVERED", to: "CLOSED" };
      },
    );
    mocks.runAchievementEngine.mockRejectedValue(boom);
    await expect(run()).rejects.toBe(boom);
  });
});

describe("prismaDistributionCompletionStore.getCompletionTotals", () => {
  it("reads the entry count and both portion totals", async () => {
    mocks.queryRaw.mockReset().mockResolvedValueOnce([
      { entries: 2, distributed: 12, unusable: 3 },
    ]);

    await expect(
      prismaDistributionCompletionStore.getCompletionTotals(DONATION_ID),
    ).resolves.toEqual({ entries: 2, distributed: 12, unusable: 3 });
  });

  it("answers zeros for a malformed id without touching the database", async () => {
    mocks.queryRaw.mockReset();

    await expect(
      prismaDistributionCompletionStore.getCompletionTotals("not-a-uuid"),
    ).resolves.toEqual({ entries: 0, distributed: 0, unusable: 0 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
