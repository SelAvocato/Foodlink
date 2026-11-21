import { describe, expect, it } from "vitest";
import {
  listAcceptedDonations,
  type AcceptedDonationRow,
  type AcceptedDonationsStore,
} from "./accepted-donations";

/** The clock the route would pass; nothing in the service reads the real one. */
const NOW = new Date("2099-11-10T08:00:00.000Z");

class FakeAcceptedDonationsStore implements AcceptedDonationsStore {
  rows: AcceptedDonationRow[] = [];
  calls: { now: Date; limit: number }[] = [];

  async findAcceptedDonations(now: Date, limit: number): Promise<AcceptedDonationRow[]> {
    this.calls.push({ now, limit });
    return [...this.rows];
  }
}

function row(overrides: Partial<AcceptedDonationRow> = {}): AcceptedDonationRow {
  return {
    donationId: "11111111-1111-4111-8111-111111111111",
    foodName: "Chicken adobo",
    portions: 25,
    donorBusinessName: "Test Bakery",
    donorFullName: "Maria Santos",
    status: "ACCEPTED",
    pickupEnd: new Date("2099-11-10T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("listAcceptedDonations", () => {
  it("orders by soonest pickup end, then donation id for a stable order", async () => {
    const store = new FakeAcceptedDonationsStore();
    store.rows = [
      row({ donationId: "d3", pickupEnd: new Date("2099-11-12T10:00:00.000Z") }),
      row({ donationId: "d2", pickupEnd: new Date("2099-11-10T10:00:00.000Z") }),
      row({ donationId: "d1", pickupEnd: new Date("2099-11-11T10:00:00.000Z") }),
      row({ donationId: "d0", pickupEnd: new Date("2099-11-11T10:00:00.000Z") }),
    ];

    const items = await listAcceptedDonations({ store }, { now: NOW, limit: 50 });

    expect(items.map((item) => item.donationId)).toEqual(["d2", "d0", "d1", "d3"]);
  });

  it("passes the caller's clock and the limit to the store", async () => {
    const store = new FakeAcceptedDonationsStore();

    await listAcceptedDonations({ store }, { now: NOW, limit: 50 });
    await listAcceptedDonations({ store }, { now: NOW, limit: 7 });

    expect(store.calls).toEqual([
      { now: NOW, limit: 50 },
      { now: NOW, limit: 7 },
    ]);
  });

  it("sends the limit to the store and still trims rows the store returns beyond it", async () => {
    const store = new FakeAcceptedDonationsStore();
    store.rows = [row({ donationId: "a" }), row({ donationId: "b" }), row({ donationId: "c" })];

    const items = await listAcceptedDonations({ store }, { now: NOW, limit: 2 });

    expect(store.calls).toEqual([{ now: NOW, limit: 2 }]);
    expect(items.map((item) => item.donationId)).toEqual(["a", "b"]);
  });

  it("drops rows past their pickup end, with no pickup end, of another status or deleted", async () => {
    const store = new FakeAcceptedDonationsStore();
    store.rows = [
      row({ donationId: "live" }),
      row({ donationId: "past", pickupEnd: new Date("2099-11-10T07:59:59.000Z") }),
      row({ donationId: "no-window", pickupEnd: null }),
      row({ donationId: "not-accepted", status: "POSTED" }),
      row({ donationId: "deleted", deletedAt: new Date("2099-11-09T00:00:00.000Z") }),
    ];

    const items = await listAcceptedDonations({ store }, { now: NOW, limit: 50 });

    expect(items.map((item) => item.donationId)).toEqual(["live"]);
  });

  it("names the donor by business name when present and by full name otherwise", async () => {
    const store = new FakeAcceptedDonationsStore();
    store.rows = [
      row({ donationId: "establishment", donorBusinessName: "Sunrise Bakery" }),
      row({ donationId: "individual", donorBusinessName: null, donorFullName: "Maria Lopez" }),
    ];

    const items = await listAcceptedDonations({ store }, { now: NOW, limit: 50 });

    expect(items.map((item) => [item.donationId, item.donorName])).toEqual([
      ["establishment", "Sunrise Bakery"],
      ["individual", "Maria Lopez"],
    ]);
  });

  it("builds each item from an allow-list, so extra store fields never leak", async () => {
    const store = new FakeAcceptedDonationsStore();
    const leaky = Object.assign(row(), {
      donorEmail: "donor@example.com",
      donorPhone: "+639170000000",
      donorUserId: "donor-user-id",
      pickupAddress: "12 Mabini St, Quezon City",
      qrToken: "qr-token-value",
      storageKey: "food-photos/secret.jpg",
    });
    store.rows = [leaky];

    const items = await listAcceptedDonations({ store }, { now: NOW, limit: 50 });

    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "donationId",
      "donorName",
      "foodName",
      "pickupEnd",
      "portions",
    ]);
    const serialized = JSON.stringify(items);
    for (const leaked of [
      "donor@example.com",
      "+639170000000",
      "donor-user-id",
      "Mabini",
      "qr-token-value",
      "secret.jpg",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("returns an empty list when the store has nothing", async () => {
    const store = new FakeAcceptedDonationsStore();

    expect(await listAcceptedDonations({ store }, { now: NOW, limit: 50 })).toEqual([]);
  });
});
