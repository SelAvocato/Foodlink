import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));

import { prismaDistributionEntryStore } from "./prisma-distribution-entry-store";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";

const entryRow = {
  id: ENTRY_ID,
  distributed_on: "2026-11-18",
  place: "Barangay hall",
  group_code: "FAMILIES",
  people_served: 30,
  portions_distributed: 12,
  notes: "Served after lunch.",
  portions_unusable: 2,
  unusable_reason: "DAMAGED",
};

const insert = {
  donationId: DONATION_ID,
  recordedByUserId: VOLUNTEER_ID,
  date: "2026-11-18",
  place: "Barangay hall",
  groupServed: "families" as const,
  peopleServed: 30,
  portionsDistributed: 12,
  portionsUnusable: 2,
  unusableReason: "damaged" as const,
  notes: "Served after lunch.",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation(
    async (
      work: (tx: {
        $queryRaw: typeof mocks.queryRaw;
        $executeRaw: typeof mocks.executeRaw;
      }) => Promise<unknown>,
    ) => work({ $queryRaw: mocks.queryRaw, $executeRaw: mocks.executeRaw }),
  );
});

describe("prismaDistributionEntryStore.readDonation", () => {
  it("maps the locked donation fields", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: DONATION_ID, status: "DELIVERED", deleted_at: null, portions: 20 },
    ]);

    await expect(prismaDistributionEntryStore.readDonation(DONATION_ID)).resolves.toEqual({
      id: DONATION_ID,
      status: "DELIVERED",
      deletedAt: null,
      portions: 20,
    });
  });

  it("answers null for a malformed id without touching the database", async () => {
    await expect(prismaDistributionEntryStore.readDonation("not-a-uuid")).resolves.toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("refuses an unknown status instead of guessing", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { id: DONATION_ID, status: "NOT_A_STATUS", deleted_at: null, portions: 20 },
    ]);

    await expect(prismaDistributionEntryStore.readDonation(DONATION_ID)).rejects.toBeTruthy();
  });
});

describe("prismaDistributionEntryStore transactions", () => {
  it("maps the locked donation and the current volunteer", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([
        { id: DONATION_ID, status: "DELIVERED", deleted_at: null, portions: 20 },
      ])
      .mockResolvedValueOnce([{ volunteer_id: VOLUNTEER_ID }]);

    const result = await prismaDistributionEntryStore.transaction(async (tx) => ({
      donation: await tx.getDonationLocked(DONATION_ID),
      volunteerId: await tx.findCurrentVolunteerId(DONATION_ID),
    }));

    expect(result).toEqual({
      donation: { id: DONATION_ID, status: "DELIVERED", deletedAt: null, portions: 20 },
      volunteerId: VOLUNTEER_ID,
    });
  });

  it("inserts the entry and its linked unusable row, then reads it back", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: ENTRY_ID }])
      .mockResolvedValueOnce([entryRow]);
    mocks.executeRaw.mockResolvedValueOnce(1);

    const result = await prismaDistributionEntryStore.transaction((tx) =>
      tx.insertEntry(insert),
    );

    expect(result).toMatchObject({
      id: ENTRY_ID,
      date: "2026-11-18",
      groupServed: "families",
      portionsUnusable: 2,
      unusableReason: "damaged",
    });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
  });

  it("does not write an unusable row when there are no unusable portions", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: ENTRY_ID }])
      .mockResolvedValueOnce([
        { ...entryRow, portions_unusable: 0, unusable_reason: null },
      ]);

    await prismaDistributionEntryStore.transaction((tx) =>
      tx.insertEntry({ ...insert, portionsUnusable: 0, unusableReason: null }),
    );

    expect(mocks.executeRaw).not.toHaveBeenCalled();
  });

  it("replaces the linked unusable row on update", async () => {
    mocks.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    mocks.queryRaw.mockResolvedValueOnce([entryRow]);

    const result = await prismaDistributionEntryStore.transaction((tx) =>
      tx.updateEntry({ ...insert, entryId: ENTRY_ID }),
    );

    expect(result).toMatchObject({ id: ENTRY_ID, portionsUnusable: 2 });
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3);
  });

  it("throws when the entry update affects no row so the unusable delete rolls back", async () => {
    mocks.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      prismaDistributionEntryStore.transaction((tx) =>
        tx.updateEntry({ ...insert, entryId: ENTRY_ID }),
      ),
    ).rejects.toThrow("Distribution entry update affected no rows");
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("deletes by id and donation and reports whether a row changed", async () => {
    mocks.executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    await expect(
      prismaDistributionEntryStore.transaction((tx) =>
        tx.deleteEntry(DONATION_ID, ENTRY_ID),
      ),
    ).resolves.toBe(true);
    await expect(
      prismaDistributionEntryStore.transaction((tx) =>
        tx.deleteEntry(DONATION_ID, ENTRY_ID),
      ),
    ).resolves.toBe(false);
  });

  it("refuses an unknown group or unusable reason in a stored row", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ id: ENTRY_ID }])
      .mockResolvedValueOnce([{ ...entryRow, group_code: "UNKNOWN" }]);
    await expect(
      prismaDistributionEntryStore.transaction((tx) => tx.insertEntry(insert)),
    ).rejects.toThrow("Unknown beneficiary group code");

    mocks.queryRaw
      .mockReset()
      .mockResolvedValueOnce([{ id: ENTRY_ID }])
      .mockResolvedValueOnce([{ ...entryRow, unusable_reason: "UNKNOWN" }]);
    await expect(
      prismaDistributionEntryStore.transaction((tx) => tx.insertEntry(insert)),
    ).rejects.toThrow("Unknown unusable reason");
  });
});
