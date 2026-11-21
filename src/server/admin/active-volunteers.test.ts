import { describe, expect, it } from "vitest";
import {
  listActiveVolunteers,
  type ActiveVolunteerRow,
  type ActiveVolunteersStore,
} from "./active-volunteers";

class FakeActiveVolunteersStore implements ActiveVolunteersStore {
  rows: ActiveVolunteerRow[] = [];
  calls: number[] = [];

  async findActiveVolunteers(limit: number): Promise<ActiveVolunteerRow[]> {
    this.calls.push(limit);
    return [...this.rows];
  }
}

function row(overrides: Partial<ActiveVolunteerRow> = {}): ActiveVolunteerRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Test Volunteer",
    availability: "Weekends",
    role: "VOLUNTEER",
    status: "ACTIVE",
    deletedAt: null,
    ...overrides,
  };
}

describe("listActiveVolunteers", () => {
  it("orders by full name ascending, then id for a stable order", async () => {
    const store = new FakeActiveVolunteersStore();
    store.rows = [
      row({ id: "u3", fullName: "Mika Santos" }),
      row({ id: "u2", fullName: "Ana Reyes" }),
      row({ id: "u0", fullName: "Carlo Dela Cruz" }),
      row({ id: "u1", fullName: "Ana Reyes" }),
    ];

    const items = await listActiveVolunteers({ store }, { limit: 50 });

    expect(items.map((item) => [item.fullName, item.volunteerId])).toEqual([
      ["Ana Reyes", "u1"],
      ["Ana Reyes", "u2"],
      ["Carlo Dela Cruz", "u0"],
      ["Mika Santos", "u3"],
    ]);
  });

  it("sends the limit to the store and still trims rows the store returns beyond it", async () => {
    const store = new FakeActiveVolunteersStore();
    store.rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];

    const items = await listActiveVolunteers({ store }, { limit: 2 });

    expect(store.calls).toEqual([2]);
    expect(items.map((item) => item.volunteerId)).toEqual(["a", "b"]);
  });

  it("asks the store for the list and keeps only ACTIVE, non-deleted volunteers", async () => {
    const store = new FakeActiveVolunteersStore();
    store.rows = [
      row({ id: "volunteer-1" }),
      row({ id: "donor-1", role: "DONOR" }),
      row({ id: "admin-1", role: "ADMIN" }),
      row({ id: "suspended-1", status: "SUSPENDED" }),
      row({ id: "deleted-1", deletedAt: new Date("2026-11-01T00:00:00.000Z") }),
    ];

    const items = await listActiveVolunteers({ store }, { limit: 100 });

    expect(store.calls).toEqual([100]);
    expect(items.map((item) => item.volunteerId)).toEqual(["volunteer-1"]);
  });

  it("builds each item from an allow-list, so extra store fields never leak", async () => {
    const store = new FakeActiveVolunteersStore();
    const leaky = Object.assign(row(), {
      email: "volunteer@example.com",
      contactNumber: "+639170000000",
      address: "12 Mabini St, Quezon City",
      passwordHash: "secret-hash",
      documents: [{ storageKey: "proofs/secret-key.jpg" }],
    });
    store.rows = [leaky];

    const items = await listActiveVolunteers({ store }, { limit: 50 });

    expect(Object.keys(items[0] ?? {}).sort()).toEqual([
      "availability",
      "fullName",
      "volunteerId",
    ]);
    const serialized = JSON.stringify(items);
    for (const leaked of [
      "volunteer@example.com",
      "+639170000000",
      "Mabini",
      "secret-hash",
      "secret-key",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("returns an empty list when the store has nothing", async () => {
    const store = new FakeActiveVolunteersStore();

    expect(await listActiveVolunteers({ store }, { limit: 100 })).toEqual([]);
  });
});
