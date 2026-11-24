import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { prismaDistributionReadStore } from "./prisma-distribution-read-store";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";

function sqlOf(index: number): string {
  const [strings] = mocks.queryRaw.mock.calls[index] as unknown as [
    TemplateStringsArray,
  ];
  return strings.join(" ");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("prismaDistributionReadStore.readDonation", () => {
  it("maps the donation and its current assignee", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: DONATION_ID,
        status: "DELIVERED",
        deleted_at: null,
        portions: 20,
        current_volunteer_id: VOLUNTEER_ID,
      },
    ]);

    await expect(prismaDistributionReadStore.readDonation(DONATION_ID)).resolves.toEqual({
      id: DONATION_ID,
      status: "DELIVERED",
      deletedAt: null,
      portions: 20,
      currentVolunteerId: VOLUNTEER_ID,
    });

    const sql = sqlOf(0);
    expect(sql).toContain("ended_at IS NULL");
    expect(sql).toContain("'CLOSED'::donation_status");
  });

  it("answers null for a malformed id without touching the database", async () => {
    await expect(
      prismaDistributionReadStore.readDonation("not-a-uuid"),
    ).resolves.toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("refuses an unknown status instead of guessing", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: DONATION_ID,
        status: "NOT_A_STATUS",
        deleted_at: null,
        portions: 20,
        current_volunteer_id: null,
      },
    ]);

    await expect(
      prismaDistributionReadStore.readDonation(DONATION_ID),
    ).rejects.toBeTruthy();
  });
});

describe("prismaDistributionReadStore.readTotals", () => {
  it("maps bigint sums to numbers and counts the entries", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { distributed: BigInt(8), unusable: BigInt(2), entry_count: BigInt(1) },
    ]);

    await expect(prismaDistributionReadStore.readTotals(DONATION_ID)).resolves.toEqual({
      distributed: 8,
      unusable: 2,
      entryCount: 1,
    });
  });

  it("sums every unusable row for the donation, including legacy unlinked rows", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      { distributed: 0, unusable: 7, entry_count: 0 },
    ]);

    await expect(prismaDistributionReadStore.readTotals(DONATION_ID)).resolves.toEqual({
      distributed: 0,
      unusable: 7,
      entryCount: 0,
    });

    const sql = sqlOf(0);
    expect(sql).toContain("FROM unusable_portions");
    expect(sql).not.toContain("entry_id");
  });

  it("answers zeros for a malformed id without touching the database", async () => {
    await expect(prismaDistributionReadStore.readTotals("not-a-uuid")).resolves.toEqual({
      distributed: 0,
      unusable: 0,
      entryCount: 0,
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});

describe("prismaDistributionReadStore.readEntries", () => {
  it("maps entry rows and their unusable reason", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: ENTRY_ID,
        distributed_on: "2026-11-18",
        place: "Barangay hall",
        group_code: "FAMILIES",
        people_served: 30,
        portions_distributed: 12,
        portions_unusable: 2,
        unusable_reason: "DAMAGED",
        notes: "Served after lunch.",
      },
    ]);

    await expect(
      prismaDistributionReadStore.readEntries(DONATION_ID),
    ).resolves.toEqual([
      {
        id: ENTRY_ID,
        distributedOn: "2026-11-18",
        place: "Barangay hall",
        groupCode: "FAMILIES",
        peopleServed: 30,
        portionsDistributed: 12,
        portionsUnusable: 2,
        unusableReasonCode: "DAMAGED",
        notes: "Served after lunch.",
      },
    ]);
  });

  it("keeps a null unusable reason", async () => {
    mocks.queryRaw.mockResolvedValueOnce([
      {
        id: ENTRY_ID,
        distributed_on: "2026-11-18",
        place: "Barangay hall",
        group_code: "FAMILIES",
        people_served: 30,
        portions_distributed: 12,
        portions_unusable: 0,
        unusable_reason: null,
        notes: null,
      },
    ]);

    const [row] = await prismaDistributionReadStore.readEntries(DONATION_ID);

    expect(row).toMatchObject({ unusableReasonCode: null, notes: null });
  });

  it("orders by distribution date, creation time and id", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await prismaDistributionReadStore.readEntries(DONATION_ID);

    expect(sqlOf(0)).toContain(
      "ORDER BY e.distributed_on ASC, e.created_at ASC, e.id ASC",
    );
  });

  it("answers an empty list for a malformed id without touching the database", async () => {
    await expect(
      prismaDistributionReadStore.readEntries("not-a-uuid"),
    ).resolves.toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
