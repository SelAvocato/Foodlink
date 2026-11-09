import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  postDonation,
  type PostDonationResult,
  type PostTransition,
  type PostingChecklist,
  type PostingDonation,
  type PostingStore,
} from "./post-donation";

const NOW = new Date("2026-11-10T08:00:00.000Z");
const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const DONATION_ID = "donation-1";
const QR_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const PICKUP_START = new Date("2026-11-10T09:00:00.000Z");
const PICKUP_END = new Date("2026-11-10T11:00:00.000Z");
const CONSUME_BY = new Date("2026-11-10T13:00:00.000Z");

/** Complete for a category with neither flag: only the shared answers are required. */
function completeChecklist(overrides: Partial<PostingChecklist> = {}): PostingChecklist {
  return {
    preparedAt: null,
    consumeByAt: CONSUME_BY,
    storageCondition: null,
    storageTemperatureC: null,
    packagingIntact: true,
    allergensConfirmed: true,
    notCustomerPlateLeftovers: true,
    completedAt: new Date("2026-11-10T07:30:00.000Z"),
    ...overrides,
  };
}

function seedRow(overrides: Partial<PostingDonation> = {}): PostingDonation {
  return {
    donorId: DONOR_ID,
    status: DonationStatus.SCREENED,
    deletedAt: null,
    pickupAddressId: "address-1",
    pickupStart: PICKUP_START,
    pickupEnd: PICKUP_END,
    requiresPreparedTime: false,
    requiresStorageInfo: false,
    checklist: completeChecklist(),
    hasActiveFoodPhoto: true,
    ...overrides,
  };
}

class FakePostingStore implements PostingStore {
  rows = new Map<string, PostingDonation>();
  reads: string[] = [];

  async readForPosting(donationId: string): Promise<PostingDonation | null> {
    this.reads.push(donationId);
    return this.rows.get(donationId) ?? null;
  }
}

class FakeTransition {
  calls: { donationId: string; donorId: string; qrToken: string }[] = [];
  result: { ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" } = { ok: true };

  readonly run: PostTransition = (input) => {
    this.calls.push({ ...input });
    return Promise.resolve(this.result);
  };
}

class FakeToken {
  calls = 0;

  readonly generate = (): string => {
    this.calls += 1;
    return QR_TOKEN;
  };
}

function setup(row: PostingDonation | null) {
  const store = new FakePostingStore();
  if (row) store.rows.set(DONATION_ID, row);
  const transition = new FakeTransition();
  const token = new FakeToken();
  return { store, transition, token };
}

type Deps = ReturnType<typeof setup>;

function post(deps: Deps): Promise<PostDonationResult> {
  return postDonation(
    {
      store: deps.store,
      transition: deps.transition.run,
      now: () => NOW,
      generateToken: deps.token.generate,
    },
    { donorId: DONOR_ID, donationId: DONATION_ID },
  );
}

/** A refusal must never reach the QR token generator or the transition. */
function expectNoAttempt(deps: Deps): void {
  expect(deps.token.calls).toBe(0);
  expect(deps.transition.calls).toEqual([]);
}

describe("postDonation", () => {
  it("posts once with the generated token and returns the pickup end as expiresAt", async () => {
    const deps = setup(seedRow());

    const result = await post(deps);

    expect(result).toEqual({
      ok: true,
      donationId: DONATION_ID,
      expiresAt: "2026-11-10T11:00:00.000Z",
    });
    expect(deps.store.reads).toEqual([DONATION_ID]);
    expect(deps.token.calls).toBe(1);
    expect(deps.transition.calls).toEqual([
      { donationId: DONATION_ID, donorId: DONOR_ID, qrToken: QR_TOKEN },
    ]);
    // The QR token never reaches the result.
    expect(result).not.toHaveProperty("qrToken");
    expect(JSON.stringify(result)).not.toContain(QR_TOKEN);
  });

  it.each([
    ["missing", null],
    ["deleted", seedRow({ deletedAt: new Date("2026-11-09T00:00:00.000Z") })],
    ["another donor's", seedRow({ donorId: OTHER_DONOR_ID })],
  ])("answers NOT_FOUND for a %s donation and never attempts the transition", async (_label, row) => {
    const deps = setup(row);

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expectNoAttempt(deps);
  });

  it("answers NOT_SCREENED for a DRAFT donation, before every other check", async () => {
    const deps = setup(
      seedRow({
        status: DonationStatus.DRAFT,
        hasActiveFoodPhoto: false,
        checklist: null,
        pickupAddressId: null,
        pickupStart: null,
        pickupEnd: null,
      }),
    );

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "NOT_SCREENED" });
    expectNoAttempt(deps);
  });

  it.each([DonationStatus.POSTED, DonationStatus.ACCEPTED])(
    "answers NOT_EDITABLE for a %s donation, before the photo check",
    async (status) => {
      const deps = setup(seedRow({ status, hasActiveFoodPhoto: false }));

      const result = await post(deps);

      expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
      expectNoAttempt(deps);
    },
  );

  it("answers PHOTO_REQUIRED when the active food photo is missing, before the checklist", async () => {
    const deps = setup(seedRow({ hasActiveFoodPhoto: false, checklist: null }));

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "PHOTO_REQUIRED" });
    expectNoAttempt(deps);
  });

  it("answers CHECKLIST_INCOMPLETE with everything the category needs when there is no checklist", async () => {
    const deps = setup(seedRow({ checklist: null }));

    const result = await post(deps);

    // evaluateChecklist() on a blank checklist, flags off: only the shared answers.
    expect(result).toEqual({
      ok: false,
      error: "CHECKLIST_INCOMPLETE",
      missing: ["consumeByAt", "packagingIntact", "allergensConfirmed", "notCustomerPlateLeftovers"],
    });
    expectNoAttempt(deps);
  });

  it("answers CHECKLIST_INCOMPLETE when the checklist was never completed", async () => {
    const deps = setup(seedRow({ checklist: completeChecklist({ completedAt: null }) }));

    const result = await post(deps);

    // The answers are complete, but completed_at was never set: still refused.
    expect(result).toEqual({ ok: false, error: "CHECKLIST_INCOMPLETE", missing: [] });
    expectNoAttempt(deps);
  });

  it.each([
    ["requiresPreparedTime", { requiresPreparedTime: true, requiresStorageInfo: false }, "preparedAt"],
    ["requiresStorageInfo", { requiresPreparedTime: false, requiresStorageInfo: true }, "storageCondition"],
  ] as const)(
    "answers CHECKLIST_INCOMPLETE when %s is set and the completed checklist lacks it",
    async (_label, flags, missingField) => {
      const deps = setup(seedRow({ ...flags, checklist: completeChecklist() }));

      const result = await post(deps);

      expect(result).toEqual(expect.objectContaining({ ok: false, error: "CHECKLIST_INCOMPLETE" }));
      if (!result.ok && result.error === "CHECKLIST_INCOMPLETE") {
        expect(result.missing).toContain(missingField);
      }
      expectNoAttempt(deps);
    },
  );

  it("answers CONSUME_BY_NOT_AFTER_PICKUP_END when consume-by is not after the pickup end", async () => {
    // fn_assert_checklist_rules (line 890): consume_by_at <= pickup_end is refused,
    // even on an otherwise complete checklist.
    const deps = setup(seedRow({ checklist: completeChecklist({ consumeByAt: PICKUP_END }) }));

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "CONSUME_BY_NOT_AFTER_PICKUP_END" });
    expectNoAttempt(deps);
  });

  it("answers CHECKLIST_INCOMPLETE before the pickup checks when both are broken", async () => {
    const deps = setup(
      seedRow({ checklist: null, pickupAddressId: null, pickupStart: null, pickupEnd: null }),
    );

    const result = await post(deps);

    expect(result).toEqual(expect.objectContaining({ ok: false, error: "CHECKLIST_INCOMPLETE" }));
    expectNoAttempt(deps);
  });

  it.each([
    ["pickupAddressId", { pickupAddressId: null }],
    ["pickupStart", { pickupStart: null }],
    ["pickupEnd", { pickupEnd: null }],
  ] as const)("answers PICKUP_REQUIRED when %s is null", async (_label, missing) => {
    const deps = setup(seedRow({ ...missing }));

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "PICKUP_REQUIRED" });
    expectNoAttempt(deps);
  });

  it.each([
    ["equal to now", "2026-11-10T08:00:00.000Z"],
    ["in the past", "2026-11-10T07:59:59.000Z"],
  ])("answers PICKUP_START_NOT_IN_FUTURE when the start is %s", async (_label, pickupStart) => {
    const deps = setup(seedRow({ pickupStart: new Date(pickupStart) }));

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: "PICKUP_START_NOT_IN_FUTURE" });
    expectNoAttempt(deps);
  });

  it("posts when the pickup start is one second after now", async () => {
    const deps = setup(seedRow({ pickupStart: new Date("2026-11-10T08:00:01.000Z") }));

    const result = await post(deps);

    expect(result).toEqual({ ok: true, donationId: DONATION_ID, expiresAt: "2026-11-10T11:00:00.000Z" });
  });

  it.each([
    ["NOT_FOUND", "NOT_FOUND"],
    ["FORBIDDEN_ACTOR", "NOT_FOUND"],
    ["INVALID_TRANSITION", "NOT_EDITABLE"],
  ] as const)("maps a transition %s to %s", async (from, to) => {
    const deps = setup(seedRow());
    deps.transition.result = { ok: false, error: from };

    const result = await post(deps);

    expect(result).toEqual({ ok: false, error: to });
    // The token was generated and handed over before the transition refused.
    expect(deps.token.calls).toBe(1);
    expect(deps.transition.calls).toHaveLength(1);
    expect(deps.transition.calls[0].qrToken).toBe(QR_TOKEN);
  });
});
