import { describe, expect, it } from "vitest";
import { saveChecklistSchema, type SaveChecklistInput } from "@/contracts/donation-checklist";
import {
  evaluateChecklist,
  getChecklist,
  normalizeAnswers,
  saveChecklist,
  type ChecklistAnswers,
  type ChecklistFlags,
  type ChecklistStore,
  type ChecklistTx,
  type ChecklistUpsert,
  type LockedDonation,
  type StoredChecklist,
} from "./donation-checklist";

const PREPARED_AT = new Date("2026-11-08T08:00:00.000Z");
const PICKUP_END = new Date("2026-11-08T12:00:00.000Z");
const CONSUME_BY = new Date("2026-11-08T14:00:00.000Z");

// ---------------------------------------------------------------------------
// Rules: fake category flags, not real category names. Every case names the
// line of fn_assert_checklist_rules or the CHECK in db/baseline/001_schema.sql
// that it mirrors.
// ---------------------------------------------------------------------------

type CategoryCase = [
  label: string,
  flags: ChecklistFlags,
  complete: ChecklistAnswers,
  requiredFields: (keyof ChecklistAnswers)[],
];

const COOKED_COMPLETE: ChecklistAnswers = {
  preparedAt: PREPARED_AT,
  consumeByAt: CONSUME_BY,
  storageCondition: "REFRIGERATED",
  storageTemperatureC: 4,
  packagingIntact: true,
  allergensConfirmed: true,
  notCustomerPlateLeftovers: true,
};
const BAKERY_COMPLETE: ChecklistAnswers = { ...COOKED_COMPLETE, storageCondition: null, storageTemperatureC: null };
const PACKAGED_COMPLETE: ChecklistAnswers = {
  ...COOKED_COMPLETE,
  preparedAt: null,
  storageCondition: null,
  storageTemperatureC: null,
};

/** missing is reported in this order: the shared checks first, then the category flags. */
const COOKED_REQUIRED: (keyof ChecklistAnswers)[] = [
  "consumeByAt",
  "packagingIntact",
  "allergensConfirmed",
  "notCustomerPlateLeftovers",
  "preparedAt",
  "storageCondition",
  "storageTemperatureC",
];
const BAKERY_REQUIRED: (keyof ChecklistAnswers)[] = [
  "consumeByAt",
  "packagingIntact",
  "allergensConfirmed",
  "notCustomerPlateLeftovers",
  "preparedAt",
];
const PACKAGED_REQUIRED: (keyof ChecklistAnswers)[] = [
  "consumeByAt",
  "packagingIntact",
  "allergensConfirmed",
  "notCustomerPlateLeftovers",
];

const CATEGORY_CASES: CategoryCase[] = [
  ["cooked-meal-like (both flags)", { requiresPreparedTime: true, requiresStorageInfo: true }, COOKED_COMPLETE, COOKED_REQUIRED],
  ["bakery-like (prepared only)", { requiresPreparedTime: true, requiresStorageInfo: false }, BAKERY_COMPLETE, BAKERY_REQUIRED],
  ["packaged-like (neither)", { requiresPreparedTime: false, requiresStorageInfo: false }, PACKAGED_COMPLETE, PACKAGED_REQUIRED],
];
const PREPARED_CATEGORIES = CATEGORY_CASES.filter(([, flags]) => flags.requiresPreparedTime);

type ConfirmationField = "packagingIntact" | "allergensConfirmed" | "notCustomerPlateLeftovers";

const CONFIRMATION_FIELDS: ConfirmationField[] = [
  "packagingIntact",
  "allergensConfirmed",
  "notCustomerPlateLeftovers",
];

describe("evaluateChecklist", () => {
  it.each(CATEGORY_CASES)("a complete checklist passes for a %s category", (_label, flags, complete) => {
    // No violations, nothing missing -> completed_at may be set.
    expect(evaluateChecklist(flags, complete, PICKUP_END)).toEqual({
      violations: [],
      missing: [],
      complete: true,
    });
  });

  it.each(CATEGORY_CASES)("a blank checklist reports exactly the required fields for %s", (_label, flags, _complete, required) => {
    // fn_assert_checklist_rules (lines 894-901) + CHECK checklist_confirmations_required:
    // completed_at needs consume-by, the three TRUE confirmations and the category's own fields.
    expect(evaluateChecklist(flags, {}, null)).toEqual({
      violations: [],
      missing: required,
      complete: false,
    });
  });

  it.each(CATEGORY_CASES)("each missing required field is reported for %s", (_label, flags, complete, required) => {
    for (const field of required) {
      const answers: Partial<ChecklistAnswers> = { ...complete };
      delete answers[field];

      const result = evaluateChecklist(flags, answers, PICKUP_END);

      expect(result.missing).toContain(field);
      expect(result.complete).toBe(false);
    }
  });

  it.each(CATEGORY_CASES)("a false confirmation is reported as missing for %s", (_label, flags, complete) => {
    // CHECK checklist_confirmations_required: the columns must be IS TRUE, so false == not answered.
    for (const field of CONFIRMATION_FIELDS) {
      const answers: Partial<ChecklistAnswers> = { ...complete };
      answers[field] = false;

      const result = evaluateChecklist(flags, answers, PICKUP_END);

      expect(result.missing).toContain(field);
      expect(result.complete).toBe(false);
    }
  });

  it.each(PREPARED_CATEGORIES)(
    "refuses consume-by equal to or before the prepared time for %s",
    (_label, flags, complete) => {
      // CHECK checklist_consume_after_prepared: consume_by_at > prepared_at, so <= is refused.
      // pickup_end is null here to isolate the prepared-time rule.
      for (const consumeByAt of [PREPARED_AT, new Date("2026-11-08T07:00:00.000Z")]) {
        const result = evaluateChecklist(flags, { ...complete, consumeByAt }, null);

        expect(result).toEqual({
          violations: ["CONSUME_BY_NOT_AFTER_PREPARED"],
          missing: [],
          complete: false,
        });
      }
    },
  );

  it.each(CATEGORY_CASES)("refuses consume-by equal to or before the pickup end for %s", (_label, flags, complete) => {
    // fn_assert_checklist_rules (line 890): consume_by_at <= pickup_end raises.
    for (const consumeByAt of [PICKUP_END, new Date("2026-11-08T11:00:00.000Z")]) {
      const result = evaluateChecklist(flags, { ...complete, consumeByAt }, PICKUP_END);

      expect(result).toEqual({
        violations: ["CONSUME_BY_NOT_AFTER_PICKUP_END"],
        missing: [],
        complete: false,
      });
    }
  });

  it.each(CATEGORY_CASES)("skips the pickup check when pickup_end is null for %s", (_label, flags, complete) => {
    // The donor sets the pickup window after the checklist, so pickup_end is often null.
    const answers = { ...complete, consumeByAt: PICKUP_END };

    expect(evaluateChecklist(flags, answers, PICKUP_END).violations).toEqual([
      "CONSUME_BY_NOT_AFTER_PICKUP_END",
    ]);
    expect(evaluateChecklist(flags, answers, null)).toEqual({ violations: [], missing: [], complete: true });
  });

  it("drops the prepared time and storage answers a packaged-like category does not use", () => {
    const flags: ChecklistFlags = { requiresPreparedTime: false, requiresStorageInfo: false };

    const normalised = normalizeAnswers(flags, {
      preparedAt: PREPARED_AT,
      storageCondition: "FROZEN",
      storageTemperatureC: -18,
    });

    expect(normalised.preparedAt).toBeNull();
    expect(normalised.storageCondition).toBeNull();
    expect(normalised.storageTemperatureC).toBeNull();
  });

  it("ignores a prepared time on a packaged-like category", () => {
    // If the field were used, consume-by 07:00 <= prepared 08:00 would violate
    // CHECK checklist_consume_after_prepared; unused fields are normalised to null first.
    const flags: ChecklistFlags = { requiresPreparedTime: false, requiresStorageInfo: false };

    const result = evaluateChecklist(
      flags,
      { ...PACKAGED_COMPLETE, preparedAt: PREPARED_AT, consumeByAt: new Date("2026-11-08T07:00:00.000Z") },
      null,
    );

    expect(result).toEqual({ violations: [], missing: [], complete: true });
  });

  it("ignores storage answers on a bakery-like category", () => {
    // fn_assert_checklist_rules only asks for storage when requires_storage_info is true.
    const flags: ChecklistFlags = { requiresPreparedTime: true, requiresStorageInfo: false };

    const result = evaluateChecklist(
      flags,
      { ...BAKERY_COMPLETE, storageCondition: "FROZEN", storageTemperatureC: -18 },
      null,
    );

    expect(result).toEqual({ violations: [], missing: [], complete: true });
  });

  it("treats a storage temperature of 0 as answered", () => {
    const flags: ChecklistFlags = { requiresPreparedTime: true, requiresStorageInfo: true };

    const result = evaluateChecklist(flags, { ...COOKED_COMPLETE, storageTemperatureC: 0 }, PICKUP_END);

    expect(result.missing).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service: an in-memory store. Rows are replaced, never mutated, so the
// snapshot restores on throw.
// ---------------------------------------------------------------------------

const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const DONATION_ID = "donation-1";

type SeedDonation = LockedDonation & { id: string };

class FakeChecklistStore implements ChecklistStore {
  donations: SeedDonation[] = [];
  rows: Partial<Record<string, StoredChecklist>> = {};
  writes: { donationId: string; row: ChecklistUpsert }[] = [];
  transactionCalls = 0;
  lockedReadCalls = 0;
  plainReadCalls = 0;
  writeBoom = false;

  async transaction<T>(work: (tx: ChecklistTx) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const snapshotRows = { ...this.rows };
    const snapshotWrites = [...this.writes];
    try {
      return await work({
        getDonationLocked: async (id) => {
          this.lockedReadCalls += 1;
          const donation = this.donations.find((candidate) => candidate.id === id);
          if (!donation) return null;
          return {
            donorId: donation.donorId,
            status: donation.status,
            pickupEnd: donation.pickupEnd,
            deletedAt: donation.deletedAt,
            requiresPreparedTime: donation.requiresPreparedTime,
            requiresStorageInfo: donation.requiresStorageInfo,
          };
        },
        upsertChecklist: async (donationId, row) => {
          if (this.writeBoom) throw new Error("boom");
          this.writes.push({ donationId, row });
          this.rows[donationId] = { ...row, updatedAt: new Date("2026-11-08T09:00:00.000Z") };
        },
      });
    } catch (error) {
      this.rows = snapshotRows;
      this.writes = snapshotWrites;
      throw error;
    }
  }

  /** Like the Prisma adapter: deleted donations are filtered out on the plain read. */
  async readDonation(id: string) {
    this.plainReadCalls += 1;
    const donation = this.donations.find((candidate) => candidate.id === id && candidate.deletedAt === null);
    if (!donation) return null;
    return {
      donorId: donation.donorId,
      pickupEnd: donation.pickupEnd,
      requiresPreparedTime: donation.requiresPreparedTime,
      requiresStorageInfo: donation.requiresStorageInfo,
    };
  }

  async readChecklist(donationId: string): Promise<StoredChecklist | null> {
    this.plainReadCalls += 1;
    const row = this.rows[donationId];
    return row ? { ...row } : null;
  }
}

function seedDonation(store: FakeChecklistStore, overrides: Partial<SeedDonation> = {}): void {
  store.donations.push({
    id: DONATION_ID,
    donorId: DONOR_ID,
    status: "DRAFT",
    pickupEnd: null,
    deletedAt: null,
    requiresPreparedTime: true,
    requiresStorageInfo: true,
    ...overrides,
  });
}

function makeStore(overrides: Partial<SeedDonation> = {}): FakeChecklistStore {
  const store = new FakeChecklistStore();
  seedDonation(store, overrides);
  return store;
}

function input(fields: Record<string, unknown>): SaveChecklistInput {
  return saveChecklistSchema.parse(fields);
}

const COMPLETE_BODY = {
  preparedAt: "2026-11-08T08:00:00Z",
  consumeByAt: "2026-11-08T14:00:00Z",
  storageCondition: "REFRIGERATED",
  storageTemperatureC: 4,
  packagingIntact: true,
  allergensConfirmed: true,
  notCustomerPlateLeftovers: true,
};

describe("saveChecklist", () => {
  it("saves partial progress with completedAt null", async () => {
    const store = makeStore();

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input({ consumeByAt: "2026-11-08T14:00:00Z", packagingIntact: true }) },
    );

    expect(result).toEqual({
      ok: true,
      complete: false,
      missing: [
        "allergensConfirmed",
        "notCustomerPlateLeftovers",
        "preparedAt",
        "storageCondition",
        "storageTemperatureC",
      ],
    });
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.row.completedAt).toBeNull();
  });

  it("saves a complete checklist with completedAt set", async () => {
    const store = makeStore();

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) },
    );

    expect(result).toEqual({ ok: true, complete: true, missing: [] });
    const written = store.writes[0]?.row;
    expect(written?.completedAt).toBeInstanceOf(Date);
    expect(written?.storageCondition).toBe("REFRIGERATED");
    expect(written?.storageTemperatureC).toBe(4);
    expect(written?.consumeByAt).toEqual(CONSUME_BY);
  });

  it("replaces the whole row on a later partial PUT and clears completedAt", async () => {
    const store = makeStore();
    await saveChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) });

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input({ consumeByAt: "2026-11-08T15:00:00Z" }) },
    );

    expect(result.ok).toBe(true);
    const row = store.rows[DONATION_ID];
    expect(row?.completedAt).toBeNull();
    expect(row?.consumeByAt).toEqual(new Date("2026-11-08T15:00:00.000Z"));
    // PUT semantics: anything not sent is stored as null again.
    expect(row?.packagingIntact).toBeNull();
    expect(row?.preparedAt).toBeNull();
    expect(row?.storageTemperatureC).toBeNull();
  });

  it("returns NOT_FOUND for a missing, deleted or foreign donation and writes nothing", async () => {
    const store = makeStore();
    seedDonation(store, { id: "donation-foreign", donorId: OTHER_DONOR_ID });
    seedDonation(store, { id: "donation-deleted", deletedAt: new Date("2026-11-07T00:00:00.000Z") });

    const missing = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: "no-such-donation", input: input(COMPLETE_BODY) },
    );
    const foreign = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: "donation-foreign", input: input(COMPLETE_BODY) },
    );
    const deleted = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: "donation-deleted", input: input(COMPLETE_BODY) },
    );

    expect(missing).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(foreign).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(deleted).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.writes).toHaveLength(0);
  });

  it("returns NOT_EDITABLE for a POSTED donation and writes nothing", async () => {
    const store = makeStore({ status: "POSTED" });

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) },
    );

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.writes).toHaveLength(0);
  });

  it("works for a SCREENED donation", async () => {
    const store = makeStore({ status: "SCREENED" });

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) },
    );

    expect(result).toEqual({ ok: true, complete: true, missing: [] });
    expect(store.writes).toHaveLength(1);
  });

  it("refuses consume-by at or before the prepared time without writing", async () => {
    const store = makeStore();

    const result = await saveChecklist(
      { store },
      {
        donorId: DONOR_ID,
        donationId: DONATION_ID,
        input: input({ ...COMPLETE_BODY, consumeByAt: "2026-11-08T08:00:00Z" }),
      },
    );

    expect(result).toEqual({ ok: false, error: "CONSUME_BY_NOT_AFTER_PREPARED" });
    expect(store.writes).toHaveLength(0);
  });

  it("refuses consume-by at or before the pickup end without writing", async () => {
    const store = makeStore({ pickupEnd: PICKUP_END });

    const result = await saveChecklist(
      { store },
      {
        donorId: DONOR_ID,
        donationId: DONATION_ID,
        input: input({ ...COMPLETE_BODY, consumeByAt: "2026-11-08T12:00:00Z" }),
      },
    );

    expect(result).toEqual({ ok: false, error: "CONSUME_BY_NOT_AFTER_PICKUP_END" });
    expect(store.writes).toHaveLength(0);
  });
});

describe("getChecklist", () => {
  it("returns the stored row as ISO strings with complete and missing", async () => {
    const store = makeStore();
    store.rows[DONATION_ID] = {
      preparedAt: PREPARED_AT,
      consumeByAt: CONSUME_BY,
      storageCondition: "REFRIGERATED",
      storageTemperatureC: 4,
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: true,
      completedAt: new Date("2026-11-08T09:00:00.000Z"),
      updatedAt: new Date("2026-11-08T09:30:00.000Z"),
    };

    const result = await getChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      checklist: {
        preparedAt: "2026-11-08T08:00:00.000Z",
        consumeByAt: "2026-11-08T14:00:00.000Z",
        storageCondition: "REFRIGERATED",
        storageTemperatureC: 4,
        packagingIntact: true,
        allergensConfirmed: true,
        notCustomerPlateLeftovers: true,
        completedAt: "2026-11-08T09:00:00.000Z",
        updatedAt: "2026-11-08T09:30:00.000Z",
      },
      complete: true,
      missing: [],
    });
  });

  it("returns a null checklist and the blank missing list when nothing was saved", async () => {
    const store = makeStore();

    const result = await getChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      checklist: null,
      complete: false,
      missing: COOKED_REQUIRED,
    });
  });

  it("reads a POSTED donation: reading has no status restriction", async () => {
    const store = makeStore({ status: "POSTED" });

    const result = await getChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);
    expect(result.checklist).toBeNull();
  });

  it("returns NOT_FOUND for a missing, deleted or foreign donation", async () => {
    const store = makeStore();
    seedDonation(store, { id: "donation-foreign", donorId: OTHER_DONOR_ID });
    seedDonation(store, { id: "donation-deleted", deletedAt: new Date("2026-11-07T00:00:00.000Z") });

    const missing = await getChecklist({ store }, { donorId: DONOR_ID, donationId: "no-such-donation" });
    const foreign = await getChecklist({ store }, { donorId: DONOR_ID, donationId: "donation-foreign" });
    const deleted = await getChecklist({ store }, { donorId: DONOR_ID, donationId: "donation-deleted" });

    expect(missing).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(foreign).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(deleted).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("reads without opening a transaction", async () => {
    const store = makeStore();

    await getChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(store.transactionCalls).toBe(0);
    expect(store.plainReadCalls).toBe(2);
    expect(store.lockedReadCalls).toBe(0);
  });
});

describe("store rules", () => {
  it("runs the save inside one transaction and calls the locked read, never a plain read", async () => {
    const store = makeStore();

    await saveChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) });

    expect(store.transactionCalls).toBe(1);
    expect(store.lockedReadCalls).toBe(1);
    expect(store.plainReadCalls).toBe(0);
  });

  it("never writes a status field", async () => {
    const store = makeStore();

    await saveChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) });

    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]?.row).not.toHaveProperty("status");
    expect(store.donations[0]?.status).toBe("DRAFT");
  });

  it("stores the fields a packaged-like category does not use as null", async () => {
    const store = makeStore({ requiresPreparedTime: false, requiresStorageInfo: false });

    const result = await saveChecklist(
      { store },
      { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) },
    );

    expect(result).toEqual({ ok: true, complete: true, missing: [] });
    const row = store.rows[DONATION_ID];
    expect(row?.preparedAt).toBeNull();
    expect(row?.storageCondition).toBeNull();
    expect(row?.storageTemperatureC).toBeNull();
    expect(row?.consumeByAt).toEqual(CONSUME_BY);
    expect(row?.completedAt).toBeInstanceOf(Date);
  });

  it("rolls back when the upsert throws and rethrows", async () => {
    const store = makeStore();
    store.writeBoom = true;

    await expect(
      saveChecklist({ store }, { donorId: DONOR_ID, donationId: DONATION_ID, input: input(COMPLETE_BODY) }),
    ).rejects.toThrow("boom");
    expect(store.writes).toHaveLength(0);
    expect(store.rows).toEqual({});
  });
});
