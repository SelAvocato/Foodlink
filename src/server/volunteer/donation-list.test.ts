import { describe, expect, it, vi } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type {
  VolunteerDonationListQuery,
  VolunteerDonationListRow,
} from "@/contracts/volunteer-donation-list";
import { getVolunteerDonationList, type VolunteerDonationListStore } from "./donation-list";

const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

function row(overrides: Partial<VolunteerDonationListRow> = {}): VolunteerDonationListRow {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: DonationStatus.ASSIGNED,
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: new Date("2026-11-14T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-14T10:00:00.000Z"),
    donorName: "Test Bakery",
    donorPhone: "+639170000000",
    ...overrides,
  };
}

function query(overrides: Partial<VolunteerDonationListQuery> = {}): VolunteerDonationListQuery {
  return { page: 1, pageSize: 20, ...overrides };
}

function fakeStore(
  page: { rows: VolunteerDonationListRow[]; total: number } = { rows: [row()], total: 1 },
) {
  const findPage = vi.fn<VolunteerDonationListStore["findPage"]>(async () => page);
  const store: VolunteerDonationListStore = { findPage };
  return { store, findPage };
}

describe("getVolunteerDonationList", () => {
  it("asks for the session volunteer's three statuses by default", async () => {
    const { store, findPage } = fakeStore();

    await getVolunteerDonationList({ store }, { volunteerId: VOLUNTEER_ID, query: query() });

    expect(findPage).toHaveBeenCalledTimes(1);
    expect(findPage).toHaveBeenCalledWith({
      volunteerId: VOLUNTEER_ID,
      statuses: [DonationStatus.ASSIGNED, DonationStatus.PICKED_UP, DonationStatus.DELIVERED],
      limit: 20,
      offset: 0,
    });
  });

  it("narrows to the one status when a filter is sent", async () => {
    const { store, findPage } = fakeStore();

    await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query({ status: DonationStatus.PICKED_UP }) },
    );

    expect(findPage).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [DonationStatus.PICKED_UP] }),
    );
  });

  it("turns the page into a limit and an offset", async () => {
    const { store, findPage } = fakeStore();

    await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query({ page: 3, pageSize: 10 }) },
    );

    expect(findPage).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
  });

  it("derives the short code from the donation id", async () => {
    const { store } = fakeStore();

    const result = await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query() },
    );

    expect(result.items[0]?.shortCode).toBe("ABCDEF12");
  });

  it("maps every item field and keeps the store's order", async () => {
    const { store } = fakeStore({
      rows: [
        row({
          donationId: "bbbbbbbb-1111-4111-8111-111111111111",
          pickupEnd: new Date("2026-11-15T10:00:00.000Z"),
        }),
        row({
          donationId: "aaaaaaaa-2222-4222-8222-222222222222",
          pickupEnd: new Date("2026-11-16T10:00:00.000Z"),
        }),
      ],
      total: 2,
    });

    const result = await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query() },
    );

    expect(result.items.map((item) => item.donationId)).toEqual([
      "bbbbbbbb-1111-4111-8111-111111111111",
      "aaaaaaaa-2222-4222-8222-222222222222",
    ]);
    expect(result.items[0]).toEqual({
      donationId: "bbbbbbbb-1111-4111-8111-111111111111",
      shortCode: "BBBBBBBB",
      foodName: "Chicken adobo",
      category: "Cooked meals",
      portions: 25,
      status: DonationStatus.ASSIGNED,
      pickupAddress: "12 Mabini St, Quezon City",
      pickupStart: new Date("2026-11-14T08:00:00.000Z"),
      pickupEnd: new Date("2026-11-15T10:00:00.000Z"),
      donorName: "Test Bakery",
      donorPhone: "+639170000000",
    });
  });

  it("returns the page, the page size and the true total", async () => {
    const { store } = fakeStore({ rows: [row()], total: 42 });

    const result = await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query({ page: 2, pageSize: 5 }) },
    );

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(5);
    expect(result.total).toBe(42);
    expect(result.items).toHaveLength(1);
  });

  it("returns an empty page past the end with the true total", async () => {
    const { store } = fakeStore({ rows: [], total: 42 });

    const result = await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query({ page: 9, pageSize: 20 }) },
    );

    expect(result.items).toEqual([]);
    expect(result.total).toBe(42);
    expect(result.page).toBe(9);
  });

  it("keeps exactly the item fields and none of the private ones", async () => {
    const { store } = fakeStore({
      rows: [
        Object.assign(row(), {
          volunteerId: VOLUNTEER_ID,
          donorId: "donor-id",
          donorEmail: "donor@example.com",
          addressId: "address-id",
          qrToken: "qr-token-value",
          storageKey: "food-photos/secret.jpg",
          description: "Secret description",
        }),
      ],
      total: 1,
    });

    const result = await getVolunteerDonationList(
      { store },
      { volunteerId: VOLUNTEER_ID, query: query() },
    );

    expect(Object.keys(result.items[0] ?? {}).sort()).toEqual(
      [
        "category",
        "donationId",
        "donorName",
        "donorPhone",
        "foodName",
        "pickupAddress",
        "pickupEnd",
        "pickupStart",
        "portions",
        "shortCode",
        "status",
      ].sort(),
    );
    const serialized = JSON.stringify(result.items);
    for (const leaked of [
      VOLUNTEER_ID,
      "donor-id",
      "donor@example.com",
      "address-id",
      "qr-token-value",
      "secret.jpg",
      "Secret description",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});
