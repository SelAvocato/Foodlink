import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type {
  DistributionEntryView,
  GroupServed,
  UnusableReason,
} from "@/contracts/volunteer-distribution";
import {
  createDistributionEntry,
  deleteDistributionEntry,
  updateDistributionEntry,
  type DistributionDonation,
  type DistributionEntryStore,
  type DistributionEntryTx,
  type DistributionEntryUpdate,
  type DistributionEntryWrite,
  type DistributionTotals,
} from "./distribution-entries";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";

function donation(overrides: Partial<DistributionDonation> = {}): DistributionDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.DELIVERED,
    deletedAt: null,
    portions: 20,
    ...overrides,
  };
}

function entry(overrides: Partial<DistributionEntryView> = {}): DistributionEntryView {
  return {
    id: ENTRY_ID,
    date: "2026-11-18",
    place: "Barangay hall",
    groupServed: "families",
    peopleServed: 30,
    portionsDistributed: 8,
    portionsUnusable: 2,
    unusableReason: "damaged",
    notes: null,
    ...overrides,
  };
}

class FakeStore implements DistributionEntryStore {
  donationRow: DistributionDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  entries: DistributionEntryView[] = [];
  legacy: DistributionTotals = { distributed: 0, unusable: 0 };
  insertCalls: DistributionEntryWrite[] = [];
  updateCalls: DistributionEntryUpdate[] = [];
  deleteCalls: { donationId: string; entryId: string }[] = [];
  nextId = 1;

  async readDonation(): Promise<DistributionDonation | null> {
    return this.donationRow;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async transaction<T>(work: (tx: DistributionEntryTx) => Promise<T>): Promise<T> {
    return work({
      getDonationLocked: async () => this.donationRow,
      findCurrentVolunteerId: async () => this.currentVolunteerId,
      findEntry: async (_donationId, entryId) =>
        this.entries.find((item) => item.id === entryId) ?? null,
      insertEntry: async (input) => {
        this.insertCalls.push(input);
        const inserted = entry({
          id: `entry-${this.nextId++}`,
          date: input.date,
          place: input.place,
          groupServed: input.groupServed,
          peopleServed: input.peopleServed,
          portionsDistributed: input.portionsDistributed,
          portionsUnusable: input.portionsUnusable,
          unusableReason: input.unusableReason,
          notes: input.notes,
        });
        this.entries.push(inserted);
        return inserted;
      },
      updateEntry: async (input) => {
        this.updateCalls.push(input);
        const index = this.entries.findIndex((item) => item.id === input.entryId);
        if (index < 0) return null;
        const updated = entry({
          id: input.entryId,
          date: input.date,
          place: input.place,
          groupServed: input.groupServed,
          peopleServed: input.peopleServed,
          portionsDistributed: input.portionsDistributed,
          portionsUnusable: input.portionsUnusable,
          unusableReason: input.unusableReason,
          notes: input.notes,
        });
        this.entries[index] = updated;
        return updated;
      },
      deleteEntry: async (donationId, entryId) => {
        this.deleteCalls.push({ donationId, entryId });
        const before = this.entries.length;
        this.entries = this.entries.filter((item) => item.id !== entryId);
        return this.entries.length < before;
      },
      getTotals: async () => ({
        distributed:
          this.legacy.distributed +
          this.entries.reduce((total, item) => total + item.portionsDistributed, 0),
        unusable:
          this.legacy.unusable +
          this.entries.reduce((total, item) => total + item.portionsUnusable, 0),
      }),
    });
  }
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-11-18",
    place: "Barangay hall",
    groupServed: "families" as GroupServed,
    peopleServed: 30,
    portionsDistributed: 8,
    portionsUnusable: 2,
    unusableReason: "damaged" as UnusableReason,
    ...overrides,
  };
}

describe("createDistributionEntry", () => {
  it("inserts the entry and returns reconciliation progress", async () => {
    const store = new FakeStore();

    const result = await createDistributionEntry(
      { store },
      { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
    );

    expect(result).toMatchObject({
      ok: true,
      progress: { accountedPortions: 10, totalPortions: 20, remainingPortions: 10 },
    });
    expect(store.insertCalls).toHaveLength(1);
    expect(store.insertCalls[0]).toMatchObject({
      donationId: DONATION_ID,
      recordedByUserId: VOLUNTEER_ID,
      portionsDistributed: 8,
      portionsUnusable: 2,
    });
  });

  it("refuses an allocation that would exceed the donation", async () => {
    const store = new FakeStore();
    store.entries = [entry({ portionsDistributed: 12, portionsUnusable: 2 })];
    store.insertCalls = [];

    const result = await createDistributionEntry(
      { store },
      {
        volunteerId: VOLUNTEER_ID,
        donationId: DONATION_ID,
        input: createInput({ portionsDistributed: 7, portionsUnusable: 0, unusableReason: undefined }),
      },
    );

    expect(result).toEqual({ ok: false, error: "PORTIONS_EXCEEDED" });
    expect(store.insertCalls).toHaveLength(0);
  });

  it("counts unlinked legacy unusable portions in the allocation", async () => {
    const store = new FakeStore();
    store.legacy = { distributed: 0, unusable: 15 };

    const result = await createDistributionEntry(
      { store },
      { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
    );

    expect(result).toEqual({ ok: false, error: "PORTIONS_EXCEEDED" });
    expect(store.insertCalls).toHaveLength(0);
  });

  it("refuses zero distributed portions, zero people or a missing reason", async () => {
    const store = new FakeStore();

    expect(
      await createDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          input: createInput({ portionsDistributed: 0 }),
        },
      ),
    ).toEqual({ ok: false, error: "INVALID_ENTRY" });
    expect(
      await createDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          input: createInput({ peopleServed: 0 }),
        },
      ),
    ).toEqual({ ok: false, error: "INVALID_ENTRY" });
    expect(
      await createDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          input: createInput({ unusableReason: undefined }),
        },
      ),
    ).toEqual({ ok: false, error: "INVALID_ENTRY" });
    expect(store.insertCalls).toHaveLength(0);
  });

  it("requires notes for the other unusable reason", async () => {
    const store = new FakeStore();

    expect(
      await createDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          input: createInput({
            unusableReason: "other" as UnusableReason,
            notes: undefined,
          }),
        },
      ),
    ).toEqual({ ok: false, error: "INVALID_ENTRY" });
  });

  it("answers NOT_FOUND for a missing, deleted or foreign donation", async () => {
    const missing = new FakeStore();
    missing.donationRow = null;
    expect(
      await createDistributionEntry(
        { store: missing },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });

    const deleted = new FakeStore();
    deleted.donationRow = donation({ deletedAt: new Date() });
    expect(
      await createDistributionEntry(
        { store: deleted },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });

    const foreign = new FakeStore();
    foreign.currentVolunteerId = OTHER_VOLUNTEER_ID;
    expect(
      await createDistributionEntry(
        { store: foreign },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("refuses a donation that is no longer DELIVERED", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.CLOSED });

    expect(
      await createDistributionEntry(
        { store },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
      ),
    ).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("re-checks the status under the lock", async () => {
    const store = new FakeStore();
    store.readDonation = async () => donation();
    store.transaction = async (work) =>
      work({
        getDonationLocked: async () => donation({ status: DonationStatus.CLOSED }),
        findCurrentVolunteerId: async () => VOLUNTEER_ID,
        findEntry: async () => null,
        insertEntry: async () => entry(),
        updateEntry: async () => null,
        deleteEntry: async () => false,
        getTotals: async () => ({ distributed: 0, unusable: 0 }),
      });

    expect(
      await createDistributionEntry(
        { store },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input: createInput() },
      ),
    ).toEqual({ ok: false, error: "INVALID_STATE" });
  });
});

describe("updateDistributionEntry", () => {
  it("merges the patch and returns progress", async () => {
    const store = new FakeStore();
    store.entries = [entry()];

    const result = await updateDistributionEntry(
      { store },
      {
        volunteerId: VOLUNTEER_ID,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
        input: { portionsDistributed: 10, portionsUnusable: 0, unusableReason: undefined },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      entry: { portionsDistributed: 10, portionsUnusable: 0, unusableReason: null },
      progress: { accountedPortions: 10, totalPortions: 20, remainingPortions: 10 },
    });
    expect(store.updateCalls).toHaveLength(1);
  });

  it("keeps the stored reason when only the unusable count changes", async () => {
    const store = new FakeStore();
    store.entries = [entry()];

    const result = await updateDistributionEntry(
      { store },
      {
        volunteerId: VOLUNTEER_ID,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
        input: { portionsUnusable: 3 },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      entry: { portionsUnusable: 3, unusableReason: "damaged" },
    });
  });

  it("keeps the stored notes when switching to the other reason", async () => {
    const store = new FakeStore();
    store.entries = [entry({ notes: "The tray tipped over." })];

    const result = await updateDistributionEntry(
      { store },
      {
        volunteerId: VOLUNTEER_ID,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
        input: { unusableReason: "other" },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      entry: { unusableReason: "other", notes: "The tray tipped over." },
    });
  });

  it("refuses an update that would exceed the donation", async () => {
    const store = new FakeStore();
    store.entries = [
      entry(),
      entry({ id: "other", portionsDistributed: 10, portionsUnusable: 0, unusableReason: null }),
    ];

    const result = await updateDistributionEntry(
      { store },
      {
        volunteerId: VOLUNTEER_ID,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
        input: { portionsDistributed: 11 },
      },
    );

    expect(result).toEqual({ ok: false, error: "PORTIONS_EXCEEDED" });
    expect(store.updateCalls).toHaveLength(0);
  });

  it("refuses an unknown entry", async () => {
    const store = new FakeStore();

    expect(
      await updateDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          entryId: ENTRY_ID,
          input: { portionsDistributed: 4 },
        },
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("re-validates the merged entry", async () => {
    const store = new FakeStore();
    store.entries = [entry({ portionsUnusable: 0, unusableReason: null })];

    expect(
      await updateDistributionEntry(
        { store },
        {
          volunteerId: VOLUNTEER_ID,
          donationId: DONATION_ID,
          entryId: ENTRY_ID,
          input: { unusableReason: "damaged" },
        },
      ),
    ).toEqual({ ok: false, error: "INVALID_ENTRY" });
  });
});

describe("deleteDistributionEntry", () => {
  it("removes the entry and returns the remaining progress", async () => {
    const store = new FakeStore();
    store.entries = [
      entry(),
      entry({ id: "other", portionsDistributed: 5, portionsUnusable: 0, unusableReason: null }),
    ];

    const result = await deleteDistributionEntry(
      { store },
      { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, entryId: ENTRY_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      entry: { id: ENTRY_ID },
      progress: { accountedPortions: 5, totalPortions: 20, remainingPortions: 15 },
    });
    expect(store.deleteCalls).toEqual([{ donationId: DONATION_ID, entryId: ENTRY_ID }]);
  });

  it("refuses an unknown entry", async () => {
    const store = new FakeStore();

    expect(
      await deleteDistributionEntry(
        { store },
        { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, entryId: ENTRY_ID },
      ),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
