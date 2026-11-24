import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import type { DistributionDonation } from "./access";
import {
  getDistributionEntries,
  type DistributionReadStore,
  type DistributionReadTotals,
} from "./entries";
import type { DistributionEntryRow } from "./entry-view";

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const SECOND_ENTRY_ID = "33333333-3333-4333-8333-333333333333";
const VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_VOLUNTEER_ID = "55555555-5555-4555-8555-555555555555";
const ADMIN_ID = "66666666-6666-4666-8666-666666666666";

function actor(role: "VOLUNTEER" | "ADMIN", id: string): AuthenticatedActor {
  return {
    id,
    email: `${role.toLowerCase()}@example.com`,
    name: "Test User",
    role,
    status: "ACTIVE",
  };
}

const volunteer = actor("VOLUNTEER", VOLUNTEER_ID);
const admin = actor("ADMIN", ADMIN_ID);

function donation(
  overrides: Partial<DistributionDonation> = {},
): DistributionDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.DELIVERED,
    deletedAt: null,
    portions: 20,
    currentVolunteerId: VOLUNTEER_ID,
    ...overrides,
  };
}

function entryRow(
  overrides: Partial<DistributionEntryRow> = {},
): DistributionEntryRow {
  return {
    id: ENTRY_ID,
    distributedOn: "2026-11-18",
    place: "Barangay hall",
    groupCode: "FAMILIES",
    peopleServed: 30,
    portionsDistributed: 8,
    portionsUnusable: 2,
    unusableReasonCode: "DAMAGED",
    notes: null,
    ...overrides,
  };
}

class FakeStore implements DistributionReadStore {
  donationRow: DistributionDonation | null = donation();
  totalsRow: DistributionReadTotals = {
    distributed: 8,
    unusable: 2,
    entryCount: 1,
  };
  entryRows: DistributionEntryRow[] = [entryRow()];
  readTotalsCalls = 0;
  readEntriesCalls = 0;

  async readDonation(): Promise<DistributionDonation | null> {
    return this.donationRow;
  }

  async readTotals(): Promise<DistributionReadTotals> {
    this.readTotalsCalls += 1;
    return this.totalsRow;
  }

  async readEntries(): Promise<DistributionEntryRow[]> {
    this.readEntriesCalls += 1;
    return this.entryRows;
  }
}

describe("getDistributionEntries access", () => {
  it("answers NOT_FOUND for a missing donation", async () => {
    const store = new FakeStore();
    store.donationRow = null;

    await expect(
      getDistributionEntries({ store }, { actor: volunteer, donationId: DONATION_ID }),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.readTotalsCalls).toBe(0);
    expect(store.readEntriesCalls).toBe(0);
  });

  it("answers NOT_FOUND for a deleted donation", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ deletedAt: new Date() });

    await expect(
      getDistributionEntries({ store }, { actor: volunteer, donationId: DONATION_ID }),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("answers NOT_FOUND for a foreign volunteer", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ currentVolunteerId: OTHER_VOLUNTEER_ID });

    await expect(
      getDistributionEntries({ store }, { actor: volunteer, donationId: DONATION_ID }),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.readTotalsCalls).toBe(0);
  });

  it("answers INVALID_STATE for any other status", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.PICKED_UP });

    await expect(
      getDistributionEntries({ store }, { actor: volunteer, donationId: DONATION_ID }),
    ).resolves.toEqual({ ok: false, error: "INVALID_STATE" });
    expect(store.readTotalsCalls).toBe(0);
  });

  it("answers INVALID_STATE for an Admin on a status that is not readable", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.PICKED_UP });

    await expect(
      getDistributionEntries({ store }, { actor: admin, donationId: DONATION_ID }),
    ).resolves.toEqual({ ok: false, error: "INVALID_STATE" });
  });
});

describe("getDistributionEntries summary and entries", () => {
  it("returns a DELIVERED donation to the assigned volunteer with add allowed", async () => {
    const store = new FakeStore();

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        id: DONATION_ID,
        referenceCode: "#ABCDEF12",
        status: DonationStatus.DELIVERED,
        totalQuantity: 20,
        unit: "portions",
        distributedQuantity: 8,
        unusableQuantity: 2,
        remainingQuantity: 10,
        entryCount: 1,
        canAddEntry: true,
        canComplete: false,
      },
      entries: [
        {
          id: ENTRY_ID,
          date: "2026-11-18",
          groupServed: "families",
          portionsUnusable: 2,
          unusableReason: "damaged",
        },
      ],
    });
  });

  it("returns a CLOSED donation read-only to the assigned volunteer", async () => {
    const store = new FakeStore();
    store.donationRow = donation({ status: DonationStatus.CLOSED });
    store.totalsRow = { distributed: 18, unusable: 2, entryCount: 2 };

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        status: DonationStatus.CLOSED,
        remainingQuantity: 0,
        canAddEntry: false,
        canComplete: false,
      },
    });
  });

  it.each([DonationStatus.DELIVERED, DonationStatus.CLOSED])(
    "returns a %s donation to an Admin with both flags false",
    async (status) => {
      const store = new FakeStore();
      store.donationRow = donation({ status });
      store.totalsRow = { distributed: 18, unusable: 2, entryCount: 2 };

      const result = await getDistributionEntries(
        { store },
        { actor: admin, donationId: DONATION_ID },
      );

      expect(result).toMatchObject({
        ok: true,
        summary: { status, canAddEntry: false, canComplete: false },
      });
    },
  );

  it("counts legacy unusable rows in the summary", async () => {
    const store = new FakeStore();
    store.totalsRow = { distributed: 8, unusable: 7, entryCount: 1 };

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: { unusableQuantity: 7, remainingQuantity: 5 },
    });
  });

  it("keeps the order the store returns", async () => {
    const store = new FakeStore();
    store.entryRows = [
      entryRow({ id: ENTRY_ID, distributedOn: "2026-11-17" }),
      entryRow({ id: SECOND_ENTRY_ID, distributedOn: "2026-11-18" }),
    ];
    store.totalsRow = { distributed: 16, unusable: 0, entryCount: 2 };

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result.ok && result.entries.map((entry) => entry.id)).toEqual([
      ENTRY_ID,
      SECOND_ENTRY_ID,
    ]);
  });

  it("returns an empty list with add allowed when there are no entries", async () => {
    const store = new FakeStore();
    store.totalsRow = { distributed: 0, unusable: 0, entryCount: 0 };
    store.entryRows = [];

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: {
        entryCount: 0,
        remainingQuantity: 20,
        canAddEntry: true,
        canComplete: false,
      },
      entries: [],
    });
  });

  it("marks a reconciled DELIVERED donation complete", async () => {
    const store = new FakeStore();
    store.totalsRow = { distributed: 18, unusable: 2, entryCount: 2 };

    const result = await getDistributionEntries(
      { store },
      { actor: volunteer, donationId: DONATION_ID },
    );

    expect(result).toMatchObject({
      ok: true,
      summary: { remainingQuantity: 0, canAddEntry: false, canComplete: true },
    });
  });
});
