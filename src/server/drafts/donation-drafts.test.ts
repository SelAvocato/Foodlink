import { describe, expect, it } from "vitest";
import type { AccountStatus, DonationStatus, DonorType, Role } from "@/contracts/enums";
import {
  createDraftSchema,
  updateDraftSchema,
  type CreateDraftInput,
  type UpdateDraftInput,
} from "@/contracts/donation-draft";
import {
  createDraft,
  discardDraft,
  DRAFT_LIST_LIMIT,
  listDrafts,
  updateDraft,
  type DraftListRow,
  type DraftStore,
  type DraftTx,
} from "./donation-drafts";

type InsertRow = Parameters<DraftTx["insertDraft"]>[0];
type SeedUser = { id: string; role: Role; status: AccountStatus; donorType: DonorType | null; deleted?: boolean };
type SeedCategory = { code: string; id: number; isActive: boolean; allowedForIndividuals: boolean };
type SeedCodeRow = { id: number; code: string; isActive: boolean };
type StoredDraft = InsertRow & {
  id: string;
  status: DonationStatus;
  deletedAt: Date | null;
  allergenIds: number[];
  tagIds: number[];
  createdAt: Date;
  updatedAt: Date;
};

/**
 * In-memory store. Rows are replaced, never mutated, so the array snapshot restores on throw.
 * The fake owns the DRAFT default (what the database would apply) and records every attempt
 * to write a status, so the tests can prove this service never writes one.
 */
class FakeDraftStore implements DraftStore {
  users: SeedUser[] = [];
  categories: SeedCategory[] = [];
  allergens: SeedCodeRow[] = [];
  tags: SeedCodeRow[] = [];
  drafts: StoredDraft[] = [];
  insertedRows: InsertRow[] = [];
  statusWrites: string[] = [];
  getDraftCalls = 0;
  transactionCalls = 0;
  writesBeforeGetDraft = 0;
  updateRace = false;
  mmBoom = false;
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `draft-${this.seq}`;
  }

  /** Counts writes that happen before the first getDraft, so the tests can prove the read comes first. */
  private recordWrite(): void {
    if (this.getDraftCalls === 0) this.writesBeforeGetDraft += 1;
  }

  async transaction<T>(work: (tx: DraftTx) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const snapshot = {
      users: [...this.users],
      categories: [...this.categories],
      allergens: [...this.allergens],
      tags: [...this.tags],
      drafts: [...this.drafts],
      insertedRows: [...this.insertedRows],
      statusWrites: [...this.statusWrites],
    };
    try {
      return await work({
        getDonor: async (userId) => {
          const user = this.users.find((candidate) => candidate.id === userId && !candidate.deleted);
          return user ? { role: user.role, status: user.status, donorType: user.donorType } : null;
        },
        getCategory: async (code) => {
          const category = this.categories.find((candidate) => candidate.code === code);
          if (!category) return null;
          return { id: category.id, isActive: category.isActive, allowedForIndividuals: category.allowedForIndividuals };
        },
        getAllergens: async (codes) =>
          this.allergens
            .filter((row) => row.isActive && codes.includes(row.code))
            .map(({ id, code }) => ({ id, code })),
        getDietaryTags: async (codes) =>
          this.tags.filter((row) => row.isActive && codes.includes(row.code)).map(({ id, code }) => ({ id, code })),
        insertDraft: async (row) => {
          this.recordWrite();
          this.insertedRows.push(row);
          const id = this.nextId();
          this.drafts.push({
            ...row,
            id,
            status: "DRAFT",
            deletedAt: null,
            allergenIds: [],
            tagIds: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          return { id };
        },
        getDraft: async (id) => {
          this.getDraftCalls += 1;
          const draft = this.drafts.find((candidate) => candidate.id === id && candidate.deletedAt === null);
          if (!draft) return null;
          return { donorId: draft.donorId, status: draft.status, foodCategoryId: draft.foodCategoryId };
        },
        updateDraft: async (id, donorId, allowedStatuses, fields) => {
          this.recordWrite();
          if (this.updateRace) return false;
          if (Object.keys(fields).some((key) => key === "status" || key === "deletedAt")) {
            this.statusWrites.push(id);
          }
          const index = this.drafts.findIndex(
            (candidate) =>
              candidate.id === id &&
              candidate.donorId === donorId &&
              allowedStatuses.includes(candidate.status) &&
              candidate.deletedAt === null,
          );
          if (index === -1) return false;
          const current = this.drafts[index];
          if (!current) return false;
          this.drafts[index] = { ...current, ...fields };
          return true;
        },
        replaceAllergens: async (donationId, allergenIds) => {
          this.recordWrite();
          if (this.mmBoom) throw new Error("boom");
          const index = this.drafts.findIndex((candidate) => candidate.id === donationId);
          if (index !== -1) {
            const current = this.drafts[index];
            if (current) this.drafts[index] = { ...current, allergenIds: [...allergenIds] };
          }
        },
        replaceDietaryTags: async (donationId, tagIds) => {
          this.recordWrite();
          if (this.mmBoom) throw new Error("boom");
          const index = this.drafts.findIndex((candidate) => candidate.id === donationId);
          if (index !== -1) {
            const current = this.drafts[index];
            if (current) this.drafts[index] = { ...current, tagIds: [...tagIds] };
          }
        },
        softDeleteDraft: async (id, donorId, allowedStatuses) => {
          this.recordWrite();
          if (this.updateRace) return false;
          const index = this.drafts.findIndex(
            (candidate) =>
              candidate.id === id &&
              candidate.donorId === donorId &&
              allowedStatuses.includes(candidate.status) &&
              candidate.deletedAt === null,
          );
          if (index === -1) return false;
          const current = this.drafts[index];
          if (!current) return false;
          this.drafts[index] = { ...current, deletedAt: new Date() };
          return true;
        },
      });
    } catch (error) {
      this.users = snapshot.users;
      this.categories = snapshot.categories;
      this.allergens = snapshot.allergens;
      this.tags = snapshot.tags;
      this.drafts = snapshot.drafts;
      this.insertedRows = snapshot.insertedRows;
      this.statusWrites = snapshot.statusWrites;
      throw error;
    }
  }

  /** Like FakePendingUsersStore: returns every row, so the service proves the filtering. */
  async listDrafts(): Promise<DraftListRow[]> {
    return this.drafts.map((draft) => ({
      id: draft.id,
      donorId: draft.donorId,
      foodName: draft.foodName,
      description: draft.description,
      portions: draft.portions,
      status: draft.status,
      foodCategoryCode:
        this.categories.find((candidate) => candidate.id === draft.foodCategoryId)?.code ?? "NO_CATEGORY",
      allergenCodes: draft.allergenIds.flatMap((id) => {
        const row = this.allergens.find((candidate) => candidate.id === id);
        return row ? [row.code] : [];
      }),
      dietaryTagCodes: draft.tagIds.flatMap((id) => {
        const row = this.tags.find((candidate) => candidate.id === id);
        return row ? [row.code] : [];
      }),
      deletedAt: draft.deletedAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }));
  }
}

const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";

function makeStore(): FakeDraftStore {
  const store = new FakeDraftStore();
  store.users.push(
    { id: DONOR_ID, role: "DONOR", status: "ACTIVE", donorType: "ESTABLISHMENT" },
    { id: OTHER_DONOR_ID, role: "DONOR", status: "ACTIVE", donorType: "ESTABLISHMENT" },
  );
  store.categories.push(
    { code: "COOKED_MEALS", id: 1, isActive: true, allowedForIndividuals: false },
    { code: "PACKAGED", id: 2, isActive: true, allowedForIndividuals: true },
    { code: "OLD_CATEGORY", id: 3, isActive: false, allowedForIndividuals: true },
  );
  store.allergens.push({ id: 11, code: "PEANUTS", isActive: true }, { id: 12, code: "SESAME", isActive: true });
  store.tags.push({ id: 21, code: "HALAL", isActive: true }, { id: 22, code: "VEGAN", isActive: true });
  return store;
}

function createInput(overrides: Partial<CreateDraftInput> = {}): CreateDraftInput {
  return createDraftSchema.parse({
    foodCategoryCode: "COOKED_MEALS",
    foodName: "Chicken adobo",
    portions: 25,
    ...overrides,
  });
}

function updateInput(fields: Record<string, unknown>): UpdateDraftInput {
  return updateDraftSchema.parse(fields);
}

function seedDraft(store: FakeDraftStore, overrides: Partial<StoredDraft> = {}): StoredDraft {
  const draft: StoredDraft = {
    id: "draft-1",
    donorId: DONOR_ID,
    foodCategoryId: 1,
    foodName: "Chicken adobo",
    description: null,
    portions: 25,
    status: "DRAFT",
    deletedAt: null,
    allergenIds: [],
    tagIds: [],
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: new Date("2026-11-01T00:00:00.000Z"),
    ...overrides,
  };
  store.drafts.push(draft);
  return draft;
}

function expectNoWrites(store: FakeDraftStore): void {
  expect(store.drafts).toHaveLength(0);
  expect(store.insertedRows).toHaveLength(0);
  expect(store.statusWrites).toHaveLength(0);
}

type CreateRefusalCase = [
  label: string,
  setup: (store: FakeDraftStore) => string,
  overrides: Partial<CreateDraftInput>,
  error: string,
];

const createRefusalCases: CreateRefusalCase[] = [
  ["an unknown category", () => DONOR_ID, { foodCategoryCode: "NOPE" }, "UNKNOWN_CATEGORY"],
  ["an inactive category", () => DONOR_ID, { foodCategoryCode: "OLD_CATEGORY" }, "UNKNOWN_CATEGORY"],
  ["an unknown allergen", () => DONOR_ID, { allergenCodes: ["SOY"] }, "UNKNOWN_ALLERGEN"],
  ["an unknown dietary tag", () => DONOR_ID, { dietaryTagCodes: ["KOSHER"] }, "UNKNOWN_DIETARY_TAG"],
  [
    "a donor that is not ACTIVE",
    (store) => {
      store.users.push({ id: "pending-1", role: "DONOR", status: "PENDING", donorType: null });
      return "pending-1";
    },
    {},
    "DONOR_NOT_ACTIVE",
  ],
  [
    "a VOLUNTEER donor",
    (store) => {
      store.users.push({ id: "volunteer-1", role: "VOLUNTEER", status: "ACTIVE", donorType: null });
      return "volunteer-1";
    },
    {},
    "DONOR_NOT_ACTIVE",
  ],
  [
    "an ADMIN donor",
    (store) => {
      store.users.push({ id: "admin-1", role: "ADMIN", status: "ACTIVE", donorType: null });
      return "admin-1";
    },
    {},
    "DONOR_NOT_ACTIVE",
  ],
  ["a missing donor", () => "missing-1", {}, "DONOR_NOT_ACTIVE"],
];

describe("createDraft", () => {
  it("creates a draft for an ESTABLISHMENT donor with allergens and tags, no status and no pickup fields", async () => {
    const store = makeStore();
    const input = createInput({
      description: "From today's lunch service",
      allergenCodes: ["PEANUTS"],
      dietaryTagCodes: ["HALAL"],
    });

    const result = await createDraft({ store }, { donorId: DONOR_ID, input });
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);

    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]).toMatchObject({
      id: result.donationId,
      donorId: DONOR_ID,
      foodCategoryId: 1,
      foodName: "Chicken adobo",
      description: "From today's lunch service",
      portions: 25,
      status: "DRAFT",
      allergenIds: [11],
      tagIds: [21],
    });
    expect(store.drafts[0]?.deletedAt).toBeNull();

    // The code never sends a status or any pickup field; the database default applies.
    const raw = store.insertedRows[0];
    expect(raw).not.toHaveProperty("status");
    expect(raw).not.toHaveProperty("pickupAddressId");
    expect(raw).not.toHaveProperty("pickupStart");
    expect(raw).not.toHaveProperty("pickupEnd");
    expect(store.statusWrites).toHaveLength(0);
  });

  it("lets an INDIVIDUAL donor create a draft with an allowed category", async () => {
    const store = makeStore();
    store.users.push({ id: "individual-1", role: "DONOR", status: "ACTIVE", donorType: "INDIVIDUAL" });

    const result = await createDraft({ store }, {
      donorId: "individual-1",
      input: createInput({ foodCategoryCode: "PACKAGED" }),
    });
    expect(result).toEqual({ ok: true, donationId: "draft-1" });
    expect(store.drafts[0]).toMatchObject({ donorId: "individual-1", foodCategoryId: 2, status: "DRAFT" });
  });

  it("refuses a not-allowed category for an INDIVIDUAL donor and writes nothing", async () => {
    const store = makeStore();
    store.users.push({ id: "individual-1", role: "DONOR", status: "ACTIVE", donorType: "INDIVIDUAL" });

    const result = await createDraft({ store }, { donorId: "individual-1", input: createInput() });
    expect(result).toEqual({ ok: false, error: "CATEGORY_NOT_ALLOWED" });
    expectNoWrites(store);
  });

  it.each(createRefusalCases)("writes nothing when creating for %s", async (_label, setup, overrides, error) => {
    const store = makeStore();
    const donorId = setup(store);

    const result = await createDraft({ store }, { donorId, input: createInput(overrides) });
    expect(result).toEqual({ ok: false, error });
    expectNoWrites(store);
  });

  it("rolls back the draft insert when the M:M write fails and rethrows", async () => {
    const store = makeStore();
    store.mmBoom = true;

    await expect(
      createDraft({ store }, { donorId: DONOR_ID, input: createInput({ allergenCodes: ["PEANUTS"] }) }),
    ).rejects.toThrow("boom");
    expectNoWrites(store);
  });
});

describe("updateDraft", () => {
  it("changes only the fields that are present", async () => {
    const store = makeStore();
    seedDraft(store);

    const result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Pancit canton", portions: 40 }),
    });
    expect(result).toEqual({ ok: true });
    expect(store.drafts[0]).toMatchObject({
      foodName: "Pancit canton",
      portions: 40,
      foodCategoryId: 1,
      description: null,
      status: "DRAFT",
    });
    expect(store.statusWrites).toHaveLength(0);
  });

  it("replaces allergens when sent, clears them with [] and leaves them alone when absent", async () => {
    const store = makeStore();
    seedDraft(store, { allergenIds: [11] });

    let result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ portions: 30 }),
    });
    expect(result).toEqual({ ok: true });
    expect(store.drafts[0]?.allergenIds).toEqual([11]);

    result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ allergenCodes: ["SESAME"] }),
    });
    expect(result).toEqual({ ok: true });
    expect(store.drafts[0]?.allergenIds).toEqual([12]);

    result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ allergenCodes: [] }),
    });
    expect(result).toEqual({ ok: true });
    expect(store.drafts[0]?.allergenIds).toEqual([]);
  });

  it("edits name and portions while SCREENED", async () => {
    const store = makeStore();
    seedDraft(store, { status: "SCREENED" });

    const result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Better name", portions: 5 }),
    });
    expect(result).toEqual({ ok: true });
    expect(store.drafts[0]).toMatchObject({ foodName: "Better name", portions: 5, status: "SCREENED" });
  });

  it("changes the category in DRAFT but returns CATEGORY_LOCKED in SCREENED", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-1", status: "DRAFT" });
    seedDraft(store, { id: "draft-2", status: "SCREENED" });

    const changed = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodCategoryCode: "PACKAGED" }),
    });
    expect(changed).toEqual({ ok: true });
    expect(store.drafts[0]?.foodCategoryId).toBe(2);

    const locked = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-2",
      input: updateInput({ foodCategoryCode: "PACKAGED" }),
    });
    expect(locked).toEqual({ ok: false, error: "CATEGORY_LOCKED" });
    expect(store.drafts[1]?.foodCategoryId).toBe(1);

    const same = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-2",
      input: updateInput({ foodCategoryCode: "COOKED_MEALS", foodName: "Renamed while screened" }),
    });
    expect(same).toEqual({ ok: true });
    expect(store.drafts[1]).toMatchObject({ foodCategoryId: 1, foodName: "Renamed while screened" });
  });

  it("validates the new category on update: unknown, inactive and individual limits", async () => {
    const store = makeStore();
    store.users.push({ id: "individual-1", role: "DONOR", status: "ACTIVE", donorType: "INDIVIDUAL" });
    seedDraft(store, { id: "draft-i", donorId: "individual-1", foodCategoryId: 2 });

    const unknown = await updateDraft({ store }, {
      donorId: "individual-1",
      donationId: "draft-i",
      input: updateInput({ foodCategoryCode: "NOPE" }),
    });
    expect(unknown).toEqual({ ok: false, error: "UNKNOWN_CATEGORY" });

    const inactive = await updateDraft({ store }, {
      donorId: "individual-1",
      donationId: "draft-i",
      input: updateInput({ foodCategoryCode: "OLD_CATEGORY" }),
    });
    expect(inactive).toEqual({ ok: false, error: "UNKNOWN_CATEGORY" });

    const notAllowed = await updateDraft({ store }, {
      donorId: "individual-1",
      donationId: "draft-i",
      input: updateInput({ foodCategoryCode: "COOKED_MEALS" }),
    });
    expect(notAllowed).toEqual({ ok: false, error: "CATEGORY_NOT_ALLOWED" });
    expect(store.drafts[0]?.foodCategoryId).toBe(2);
    expect(store.drafts[0]?.foodName).toBe("Chicken adobo");
  });

  it.each(["POSTED", "CLOSED"] as const)("returns NOT_EDITABLE when updating a %s donation", async (status) => {
    const store = makeStore();
    seedDraft(store, { status });

    const result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Should not land" }),
    });
    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.drafts[0]?.foodName).toBe("Chicken adobo");
    expect(store.statusWrites).toHaveLength(0);
  });

  it("returns NOT_FOUND for another donor's draft, a missing id or an already-discarded draft", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-1", donorId: DONOR_ID });
    seedDraft(store, { id: "draft-2", donorId: OTHER_DONOR_ID });
    seedDraft(store, { id: "draft-3", donorId: DONOR_ID, deletedAt: new Date() });

    const wrongOwner = await updateDraft({ store }, {
      donorId: OTHER_DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Not mine" }),
    });
    const missing = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "no-such-draft",
      input: updateInput({ foodName: "Ghost" }),
    });
    const discarded = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-3",
      input: updateInput({ foodName: "Gone" }),
    });

    expect(wrongOwner).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(missing).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(discarded).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.drafts[0]?.foodName).toBe("Chicken adobo");
    expect(store.statusWrites).toHaveLength(0);
  });

  it("returns NOT_EDITABLE when the conditional update loses the race, writing nothing else", async () => {
    const store = makeStore();
    seedDraft(store, { allergenIds: [11] });
    store.updateRace = true;

    const result = await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Raced", allergenCodes: ["SESAME"] }),
    });
    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.drafts[0]?.foodName).toBe("Chicken adobo");
    expect(store.drafts[0]?.allergenIds).toEqual([11]);
    expect(store.statusWrites).toHaveLength(0);
  });

  it("returns NOT_FOUND and writes nothing when the donor row is gone and the category changes", async () => {
    const store = makeStore();
    store.users.push({ id: "gone-1", role: "DONOR", status: "ACTIVE", donorType: "ESTABLISHMENT", deleted: true });
    seedDraft(store, { id: "draft-g", donorId: "gone-1" });
    const before = store.drafts[0];

    const result = await updateDraft({ store }, {
      donorId: "gone-1",
      donationId: "draft-g",
      input: updateInput({ foodCategoryCode: "PACKAGED" }),
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    // The fake only ever replaces a row on write, so identical identity proves nothing was written.
    expect(store.drafts[0]).toBe(before);
    expect(store.drafts[0]).toMatchObject({ foodCategoryId: 1, foodName: "Chicken adobo", deletedAt: null });
    expect(store.statusWrites).toHaveLength(0);
  });
});

describe("discardDraft", () => {
  it("sets deleted_at and keeps the row, without touching the status", async () => {
    const store = makeStore();
    seedDraft(store);

    const result = await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });
    expect(result).toEqual({ ok: true });
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0]?.deletedAt).toBeInstanceOf(Date);
    expect(store.drafts[0]?.status).toBe("DRAFT");
    expect(store.statusWrites).toHaveLength(0);
  });

  it("returns NOT_FOUND when discarding the same draft twice", async () => {
    const store = makeStore();
    seedDraft(store);

    const first = await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });
    const second = await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.drafts).toHaveLength(1);
  });

  it("returns NOT_FOUND for another donor's draft and a missing id", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-1", donorId: DONOR_ID });

    const wrongOwner = await discardDraft({ store }, { donorId: OTHER_DONOR_ID, donationId: "draft-1" });
    const missing = await discardDraft({ store }, { donorId: DONOR_ID, donationId: "no-such-draft" });

    expect(wrongOwner).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(missing).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.drafts[0]?.deletedAt).toBeNull();
  });

  it("returns NOT_EDITABLE for a POSTED donation", async () => {
    const store = makeStore();
    seedDraft(store, { status: "POSTED" });

    const result = await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });
    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.drafts[0]?.deletedAt).toBeNull();
  });
});

describe("listDrafts", () => {
  it("returns only the caller's drafts, newest updated_at first", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-old", updatedAt: new Date("2026-11-01T00:00:00.000Z") });
    seedDraft(store, { id: "draft-new", updatedAt: new Date("2026-11-05T00:00:00.000Z") });
    seedDraft(store, {
      id: "draft-other",
      donorId: OTHER_DONOR_ID,
      updatedAt: new Date("2026-11-07T00:00:00.000Z"),
    });

    const drafts = await listDrafts({ store }, { donorId: DONOR_ID });

    expect(drafts.map((draft) => draft.id)).toEqual(["draft-new", "draft-old"]);
  });

  it("returns only DRAFT and SCREENED rows", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-a", status: "DRAFT" });
    seedDraft(store, { id: "draft-b", status: "SCREENED" });
    seedDraft(store, { id: "draft-c", status: "POSTED" });
    seedDraft(store, { id: "draft-d", status: "CLOSED" });

    const drafts = await listDrafts({ store }, { donorId: DONOR_ID });

    expect(drafts.map((draft) => draft.id)).toEqual(["draft-a", "draft-b"]);
  });

  it("excludes a discarded draft", async () => {
    const store = makeStore();
    seedDraft(store, { id: "draft-gone", deletedAt: new Date("2026-11-02T00:00:00.000Z") });

    expect(await listDrafts({ store }, { donorId: DONOR_ID })).toEqual([]);
  });

  it("returns an empty list when the donor has no drafts", async () => {
    const store = makeStore();

    expect(await listDrafts({ store }, { donorId: DONOR_ID })).toEqual([]);
  });

  it("keeps at most 50 rows, newest first", async () => {
    const store = makeStore();
    const base = new Date("2026-11-01T00:00:00.000Z").getTime();
    for (let i = 1; i <= 55; i += 1) {
      seedDraft(store, { id: `draft-${i}`, updatedAt: new Date(base + i * 60_000) });
    }

    const drafts = await listDrafts({ store }, { donorId: DONOR_ID });

    expect(drafts).toHaveLength(DRAFT_LIST_LIMIT);
    expect(drafts[0]?.id).toBe("draft-55");
    expect(drafts[DRAFT_LIST_LIMIT - 1]?.id).toBe("draft-6");
    expect(drafts.map((draft) => draft.id)).not.toContain("draft-5");
  });

  it("maps a row to the documented shape and nothing else", async () => {
    const store = makeStore();
    seedDraft(store, {
      id: "draft-1",
      description: "From today's lunch service",
      allergenIds: [11],
      tagIds: [21],
      updatedAt: new Date("2026-11-05T00:00:00.000Z"),
    });

    const drafts = await listDrafts({ store }, { donorId: DONOR_ID });

    expect(drafts).toEqual([
      {
        id: "draft-1",
        foodName: "Chicken adobo",
        description: "From today's lunch service",
        portions: 25,
        status: "DRAFT",
        foodCategoryCode: "COOKED_MEALS",
        allergenCodes: ["PEANUTS"],
        dietaryTagCodes: ["HALAL"],
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
        updatedAt: new Date("2026-11-05T00:00:00.000Z"),
      },
    ]);
    expect(drafts[0]).not.toHaveProperty("donorId");
    expect(drafts[0]).not.toHaveProperty("deletedAt");
    expect(drafts[0]).not.toHaveProperty("foodCategoryId");
  });

  it("reads without opening a transaction", async () => {
    const store = makeStore();
    seedDraft(store);

    await listDrafts({ store }, { donorId: DONOR_ID });

    expect(store.transactionCalls).toBe(0);
  });
});

describe("store rules", () => {
  it("never records a status write, a tracking event or an audit row", async () => {
    const store = makeStore();

    await createDraft({ store }, { donorId: DONOR_ID, input: createInput({ allergenCodes: ["PEANUTS"] }) });
    await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Renamed", dietaryTagCodes: ["HALAL"] }),
    });
    await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });

    expect(store.statusWrites).toHaveLength(0);
    expect(store.drafts[0]?.status).toBe("DRAFT");
    expect(store).not.toHaveProperty("trackingEvents");
    expect(store).not.toHaveProperty("audits");
  });

  it("runs getDraft before any write in update and discard", async () => {
    const store = makeStore();
    seedDraft(store);

    await updateDraft({ store }, {
      donorId: DONOR_ID,
      donationId: "draft-1",
      input: updateInput({ foodName: "Renamed" }),
    });
    expect(store.drafts[0]?.foodName).toBe("Renamed");
    expect(store.getDraftCalls).toBe(1);
    expect(store.writesBeforeGetDraft).toBe(0);

    await discardDraft({ store }, { donorId: DONOR_ID, donationId: "draft-1" });
    expect(store.drafts[0]?.deletedAt).toBeInstanceOf(Date);
    expect(store.getDraftCalls).toBe(2);
    expect(store.writesBeforeGetDraft).toBe(0);
  });
});
