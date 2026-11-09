import { describe, expect, it } from "vitest";
import type { AdminDonationQueueItem } from "@/contracts/admin-donation-queue";
import { listAdminDonationQueue, type AdminDonationQueueStore } from "./donation-queue";

class FakeQueueStore implements AdminDonationQueueStore {
  rows: AdminDonationQueueItem[] = [];
  calls: { foodCategoryId: number | null; limit: number }[] = [];

  async findPostedDonations(
    foodCategoryId: number | null,
    limit: number,
  ): Promise<AdminDonationQueueItem[]> {
    this.calls.push({ foodCategoryId, limit });
    return [...this.rows];
  }
}

function row(overrides: Partial<AdminDonationQueueItem> = {}): AdminDonationQueueItem {
  return {
    donationId: "11111111-1111-4111-8111-111111111111",
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    donorName: "Test Bakery",
    donorType: "ESTABLISHMENT",
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: new Date("2026-11-10T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-10T10:00:00.000Z"),
    postedAt: new Date("2026-11-09T08:00:00.000Z"),
    ...overrides,
  };
}

describe("listAdminDonationQueue", () => {
  it("keeps the store's order instead of sorting again", async () => {
    const store = new FakeQueueStore();
    store.rows = [
      row({ donationId: "third", pickupEnd: new Date("2026-11-12T10:00:00.000Z") }),
      row({ donationId: "first", pickupEnd: new Date("2026-11-10T10:00:00.000Z") }),
      row({ donationId: "second", pickupEnd: new Date("2026-11-11T10:00:00.000Z") }),
    ];

    const items = await listAdminDonationQueue({ store }, { limit: 50 });

    expect(items.map((item) => item.donationId)).toEqual(["third", "first", "second"]);
  });

  it("sends the limit to the store and still trims rows the store returns beyond it", async () => {
    const store = new FakeQueueStore();
    store.rows = [row({ donationId: "a" }), row({ donationId: "b" }), row({ donationId: "c" })];

    const items = await listAdminDonationQueue({ store }, { limit: 2 });

    expect(store.calls).toEqual([{ foodCategoryId: null, limit: 2 }]);
    expect(items.map((item) => item.donationId)).toEqual(["a", "b"]);
  });

  it("maps an empty pickup address to null and keeps a real one", async () => {
    const store = new FakeQueueStore();
    store.rows = [
      row({ donationId: "no-address", pickupAddress: "" }),
      row({ donationId: "null-address", pickupAddress: null }),
      row({ donationId: "real-address", pickupAddress: "12 Mabini St, Quezon City" }),
    ];

    const items = await listAdminDonationQueue({ store }, { limit: 50 });

    expect(items.map((item) => item.pickupAddress)).toEqual([
      null,
      null,
      "12 Mabini St, Quezon City",
    ]);
  });

  it("builds each item from an allow-list, so extra store fields never leak", async () => {
    const store = new FakeQueueStore();
    const leaky = Object.assign(row(), {
      donorEmail: "donor@example.com",
      donorPhone: "+639170000000",
      donorUserId: "donor-user-id",
      addressId: "address-id",
      qrToken: "qr-token-value",
      storageKey: "food-photos/secret.jpg",
    });
    store.rows = [leaky];

    const items = await listAdminDonationQueue({ store }, { limit: 50 });

    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "category",
      "donationId",
      "donorName",
      "donorType",
      "foodName",
      "pickupAddress",
      "pickupEnd",
      "pickupStart",
      "portions",
      "postedAt",
    ]);
    const serialized = JSON.stringify(items);
    for (const leaked of ["donor@example.com", "+639170000000", "donor-user-id", "address-id", "qr-token-value", "secret.jpg"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("passes the category filter and the limit through, and asks for every category when absent", async () => {
    const store = new FakeQueueStore();

    await listAdminDonationQueue({ store }, { limit: 50 });
    await listAdminDonationQueue({ store }, { limit: 7, foodCategoryId: 3 });

    expect(store.calls).toEqual([
      { foodCategoryId: null, limit: 50 },
      { foodCategoryId: 3, limit: 7 },
    ]);
  });

  it("returns an empty list when the store has nothing", async () => {
    const store = new FakeQueueStore();

    expect(await listAdminDonationQueue({ store }, { limit: 50 })).toEqual([]);
  });
});
