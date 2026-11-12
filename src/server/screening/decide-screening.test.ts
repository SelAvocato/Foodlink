import { beforeEach, describe, expect, it, vi } from "vitest";
import { screeningDecisionSchema } from "@/contracts/screening-decision";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import {
  decideScreening,
  type DecideScreeningInput,
  type ScreeningDecisionRow,
  type ScreeningDecisionStore,
  type ScreeningDecisionTransitionInput,
  type ScreeningDecisionTransitionResult,
} from "./decide-screening";

const SCREENING_ID = "11111111-1111-4111-8111-111111111111";
const DONATION_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "admin-1";
const REASON = "Mold on the surface.";

class FakeStore implements ScreeningDecisionStore {
  row: ScreeningDecisionRow | null = null;
  stamped: Array<{ screeningId: string; reviewerId: string; reviewedAt: Date }> = [];
  stampError: Error | null = null;
  /** false models an updateMany that matched no row. */
  stampApplied = true;
  /** Shared order log: the stamp must come after the transition. */
  events: string[] = [];

  async findScreening(screeningId: string): Promise<ScreeningDecisionRow | null> {
    return this.row?.screeningId === screeningId ? this.row : null;
  }

  async stampReview(input: { screeningId: string; reviewerId: string; reviewedAt: Date }): Promise<boolean> {
    this.events.push("stamp");
    if (this.stampError) throw this.stampError;
    if (!this.stampApplied) return false;
    this.stamped.push(input);
    return true;
  }
}

/** A transition that succeeds and records its place in the shared order log. */
function makeTransition(events: string[]) {
  return vi.fn(
    async (input: ScreeningDecisionTransitionInput): Promise<ScreeningDecisionTransitionResult> => {
      events.push(`transition:${input.to}`);
      return { ok: true };
    },
  );
}

function pendingRow(overrides: Partial<ScreeningDecisionRow> = {}): ScreeningDecisionRow {
  return {
    screeningId: SCREENING_ID,
    donationId: DONATION_ID,
    verdict: ScreeningVerdict.REVIEW,
    reviewedAt: null,
    donationStatus: DonationStatus.DRAFT,
    deletedAt: null,
    isLatestScreening: true,
    ...overrides,
  };
}

function input(overrides: Partial<DecideScreeningInput> = {}): DecideScreeningInput {
  return { screeningId: SCREENING_ID, actorId: ACTOR_ID, decision: "PASS", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("decideScreening", () => {
  it("PASS moves the donation to SCREENED and stamps the review after the transition", async () => {
    const store = new FakeStore();
    store.row = pendingRow();
    const transition = makeTransition(store.events);

    const result = await decideScreening({ store, transition }, input());

    expect(result).toEqual({
      ok: true,
      donationId: DONATION_ID,
      screeningId: SCREENING_ID,
      from: "DRAFT",
      to: "SCREENED",
    });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith({
      donationId: DONATION_ID,
      to: "SCREENED",
      screeningId: SCREENING_ID,
      actorId: ACTOR_ID,
    });
    expect(transition.mock.calls[0][0]).not.toHaveProperty("reason");
    expect(store.stamped).toHaveLength(1);
    expect(store.stamped[0]).toMatchObject({ screeningId: SCREENING_ID, reviewerId: ACTOR_ID });
    expect(store.stamped[0].reviewedAt).toBeInstanceOf(Date);
    expect(store.events).toEqual(["transition:SCREENED", "stamp"]);
  });

  it("REJECT moves the donation to REJECTED with the reason, then stamps", async () => {
    const store = new FakeStore();
    store.row = pendingRow();
    const transition = makeTransition(store.events);

    const result = await decideScreening({ store, transition }, input({ decision: "REJECT", reason: REASON }));

    expect(result).toEqual({
      ok: true,
      donationId: DONATION_ID,
      screeningId: SCREENING_ID,
      from: "DRAFT",
      to: "REJECTED",
    });
    expect(transition).toHaveBeenCalledWith({
      donationId: DONATION_ID,
      to: "REJECTED",
      screeningId: SCREENING_ID,
      actorId: ACTOR_ID,
      reason: REASON,
    });
    expect(store.stamped).toHaveLength(1);
    expect(store.events).toEqual(["transition:REJECTED", "stamp"]);
  });

  it("answers NOT_FOUND for a missing screening and writes nothing", async () => {
    const events: string[] = [];
    const store = new FakeStore();
    const transition = makeTransition(events);

    const result = await decideScreening({ store, transition }, input());

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(transition).not.toHaveBeenCalled();
    expect(store.stamped).toHaveLength(0);
  });

  it.each([
    ["a verdict that is not REVIEW", { verdict: ScreeningVerdict.PASS }],
    ["a FLAG verdict", { verdict: ScreeningVerdict.FLAG }],
    ["an already reviewed screening", { reviewedAt: new Date("2026-11-10T08:00:00.000Z") }],
    ["a screening that is not the latest of its donation", { isLatestScreening: false }],
    ["a donation that is not DRAFT", { donationStatus: DonationStatus.SCREENED }],
    ["a deleted donation", { deletedAt: new Date("2026-11-10T08:00:00.000Z") }],
  ])("answers NOT_PENDING for %s and writes nothing", async (_label, overrides) => {
    const events: string[] = [];
    const store = new FakeStore();
    store.row = pendingRow(overrides);
    const transition = makeTransition(events);

    const result = await decideScreening({ store, transition }, input());

    expect(result).toEqual({ ok: false, error: "NOT_PENDING" });
    expect(transition).not.toHaveBeenCalled();
    expect(store.stamped).toHaveLength(0);
  });

  it.each([
    ["INVALID_TRANSITION", "NOT_PENDING"],
    ["NOT_FOUND", "NOT_FOUND"],
  ] as const)("answers %s from the transition as %s and does not stamp", async (code, expected) => {
    const store = new FakeStore();
    store.row = pendingRow();
    const transition = vi.fn(async () => ({ ok: false, error: code }) as const);

    const result = await decideScreening({ store, transition }, input());

    expect(result).toEqual({ ok: false, error: expected });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(store.stamped).toHaveLength(0);
  });

  it("rethrows a transition error that is not mapped and does not stamp", async () => {
    const store = new FakeStore();
    store.row = pendingRow();
    const failure = new Error("connection lost");
    const transition = vi.fn(async () => {
      throw failure;
    });

    await expect(decideScreening({ store, transition }, input())).rejects.toBe(failure);
    expect(store.stamped).toHaveLength(0);
  });

  it("rejects with SCREENING_STAMP_NOT_APPLIED when the stamp updated no row", async () => {
    const store = new FakeStore();
    store.row = pendingRow();
    store.stampApplied = false;
    const transition = makeTransition(store.events);

    await expect(decideScreening({ store, transition }, input())).rejects.toThrow(
      "SCREENING_STAMP_NOT_APPLIED",
    );
    // The transition ran first and is never undone.
    expect(transition).toHaveBeenCalledTimes(1);
    expect(store.stamped).toHaveLength(0);
    expect(store.events).toEqual(["transition:SCREENED", "stamp"]);
  });

  it("propagates a stamp failure after the transition already ran", async () => {
    const store = new FakeStore();
    store.row = pendingRow();
    const failure = new Error("stamp failed");
    store.stampError = failure;
    const transition = makeTransition(store.events);

    await expect(decideScreening({ store, transition }, input())).rejects.toBe(failure);
    // The transition succeeded first and is never undone.
    expect(transition).toHaveBeenCalledTimes(1);
    expect(store.stamped).toHaveLength(0);
  });
});

describe("screeningDecisionSchema", () => {
  it("refuses a REJECT without a reason", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT" }).success).toBe(false);
  });

  it("refuses a REJECT with an empty or too-long reason", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "   " }).success).toBe(false);
    expect(
      screeningDecisionSchema.safeParse({ decision: "REJECT", reason: "x".repeat(501) }).success,
    ).toBe(false);
  });

  it("refuses a PASS with a reason", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "PASS", reason: REASON }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "PASS", reviewerId: ACTOR_ID }).success).toBe(false);
  });

  it("accepts a REJECT with a reason and trims it", () => {
    const parsed = screeningDecisionSchema.safeParse({ decision: "REJECT", reason: `  ${REASON}  ` });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.reason).toBe(REASON);
  });

  it("accepts a plain PASS", () => {
    expect(screeningDecisionSchema.safeParse({ decision: "PASS" }).success).toBe(true);
  });
});
