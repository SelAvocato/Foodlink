import { describe, expect, it, vi } from "vitest";
import type {
  DonorDonationListQuery,
  DonorDonationListRow,
} from "@/contracts/donor-donation-list";
import { DonationStatus } from "@/contracts/enums";
import { getDonorDonationList, type DonorDonationListStore } from "./donation-list";

const DONOR_ID = "22222222-2222-4222-8222-222222222222";
const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

function row(overrides: Partial<DonorDonationListRow> = {}): DonorDonationListRow {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: DonationStatus.POSTED,
    pickupStart: new Date("2026-11-14T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-14T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T09:00:00.000Z"),
    checklistComplete: true,
    ...overrides,
  };
}

function query(overrides: Partial<DonorDonationListQuery> = {}): DonorDonationListQuery {
  return { tab: "active", page: 1, pageSize: 20, ...overrides };
}

function fakeStore(
  page: { rows: DonorDonationListRow[]; total: number } = { rows: [row()], total: 1 },
) {
  const findPage = vi.fn<DonorDonationListStore["findPage"]>(async () => page);
  const countByTab = vi.fn<DonorDonationListStore["countByTab"]>(async () => ({
    drafts: 2,
    active: 3,
    completed: 4,
    notCompleted: 5,
  }));
  const store: DonorDonationListStore = { findPage, countByTab };
  return { store, findPage, countByTab };
}

describe("getDonorDonationList", () => {
  it("uses the tab's statuses when no status filter is sent", async () => {
    const { store, findPage } = fakeStore();

    await getDonorDonationList({ store }, { donorId: DONOR_ID, query: query({ tab: "not_completed" }) });

    expect(findPage).toHaveBeenCalledWith(
      expect.objectContaining({
        donorId: DONOR_ID,
        statuses: [
          DonationStatus.REJECTED,
          DonationStatus.DECLINED,
          DonationStatus.REJECTED_AT_PICKUP,
          DonationStatus.CANCELLED,
          DonationStatus.EXPIRED,
        ],
      }),
    );
  });

  it.each([
    ["drafts", [DonationStatus.DRAFT, DonationStatus.SCREENED]],
    ["completed", [DonationStatus.CLOSED]],
  ] as const)("maps the %s tab to its statuses", async (tab, statuses) => {
    const { store, findPage } = fakeStore();

    await getDonorDonationList({ store }, { donorId: DONOR_ID, query: query({ tab }) });

    expect(findPage).toHaveBeenCalledWith(expect.objectContaining({ statuses }));
  });

  it("narrows to the one status the filter names", async () => {
    const { store, findPage } = fakeStore();

    const result = await getDonorDonationList(
      { store },
      { donorId: DONOR_ID, query: query({ tab: "active", status: DonationStatus.ACCEPTED }) },
    );

    expect(findPage).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [DonationStatus.ACCEPTED] }),
    );
    expect(result.tab).toBe("active");
  });

  it("turns the page into a limit and an offset", async () => {
    const { store, findPage } = fakeStore();

    await getDonorDonationList(
      { store },
      { donorId: DONOR_ID, query: query({ page: 2, pageSize: 20 }) },
    );

    expect(findPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 20 }));
  });

  it("derives the short code from the donation id", async () => {
    const { store } = fakeStore();

    const result = await getDonorDonationList({ store }, { donorId: DONOR_ID, query: query() });

    expect(result.items[0]?.shortCode).toBe("ABCDEF12");
  });

  it("passes the cleaned search through and the counts unchanged", async () => {
    const { store, findPage, countByTab } = fakeStore();

    const result = await getDonorDonationList(
      { store },
      { donorId: DONOR_ID, query: query({ q: "adobo" }) },
    );

    expect(findPage).toHaveBeenCalledWith(expect.objectContaining({ q: "adobo" }));
    expect(countByTab).toHaveBeenCalledWith(DONOR_ID);
    expect(result.counts).toEqual({ drafts: 2, active: 3, completed: 4, notCompleted: 5 });
    expect(result).toMatchObject({ tab: "active", page: 1, pageSize: 20, total: 1 });
  });

  it("returns an empty page past the end with the true total", async () => {
    const { store } = fakeStore({ rows: [], total: 42 });

    const result = await getDonorDonationList(
      { store },
      { donorId: DONOR_ID, query: query({ page: 3, pageSize: 20 }) },
    );

    expect(result.items).toEqual([]);
    expect(result.total).toBe(42);
    expect(result.page).toBe(3);
  });

  it("keeps exactly the item fields and none of the private ones", async () => {
    const { store } = fakeStore();

    const result = await getDonorDonationList({ store }, { donorId: DONOR_ID, query: query() });

    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(
      [
        "category",
        "checklistComplete",
        "donationId",
        "foodName",
        "pickupEnd",
        "pickupStart",
        "portions",
        "shortCode",
        "status",
        "updatedAt",
      ].sort(),
    );
  });
});
