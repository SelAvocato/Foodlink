import { describe, expect, it } from "vitest";
import { adminPeopleListQuerySchema } from "@/contracts/admin-people";
import type {
  AdminPeopleCountInput,
  AdminPeopleDetails,
  AdminPeopleListInput,
  AdminPeopleRow,
  AdminPeopleStore,
} from "./people";
import { listAdminPeople } from "./people";

class FakePeopleStore implements AdminPeopleStore {
  rows: AdminPeopleRow[] = [];
  details: Record<string, AdminPeopleDetails> = {};
  total = 0;
  counts = { DONOR: 0, VOLUNTEER: 0 };
  listInputs: AdminPeopleListInput[] = [];
  countInputs: AdminPeopleCountInput[] = [];
  loadedRows: AdminPeopleRow[] = [];

  async findPeople(input: AdminPeopleListInput): Promise<AdminPeopleRow[]> {
    this.listInputs.push(input);
    return this.rows;
  }

  async countPeople(input: AdminPeopleCountInput): Promise<number> {
    this.countInputs.push(input);
    return this.total;
  }

  async countByRole(): Promise<{ DONOR: number; VOLUNTEER: number }> {
    return this.counts;
  }

  async loadDetails(rows: AdminPeopleRow[]): Promise<Record<string, AdminPeopleDetails>> {
    this.loadedRows = rows;
    return this.details;
  }
}

function row(overrides: Partial<AdminPeopleRow> = {}): AdminPeopleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    role: "DONOR",
    status: "ACTIVE",
    fullName: "Ana Reyes",
    email: "ana@example.com",
    contactNumber: "09171234567",
    donorType: "ESTABLISHMENT",
    businessName: "Ana's Bakery",
    ...overrides,
  };
}

function details(overrides: Partial<AdminPeopleDetails> = {}): AdminPeopleDetails {
  return {
    stats: {
      completedDonations: 12,
      portions: 84,
      peopleServed: 96,
      tasksCompleted: 7,
      unfinishedReports: 2,
    },
    activity: [
      {
        donationId: "12345678-1234-4234-8234-123456789012",
        toStatus: "DELIVERED",
        occurredAt: new Date("2026-11-20T01:15:00.000Z"),
      },
    ],
    ...overrides,
  };
}

function query(overrides: Record<string, string> = {}) {
  return adminPeopleListQuerySchema.parse(overrides);
}

describe("listAdminPeople", () => {
  it("returns a paginated allow-listed page with tab counts", async () => {
    const store = new FakePeopleStore();
    const donor = row();
    const volunteer = row({
      id: "22222222-2222-4222-8222-222222222222",
      role: "VOLUNTEER",
      fullName: "Ben Santos",
      email: "ben@example.com",
      contactNumber: "09187654321",
      donorType: null,
      businessName: null,
    });
    store.rows = [donor, volunteer];
    store.details = { [donor.id]: details(), [volunteer.id]: details() };
    store.total = 18;
    store.counts = { DONOR: 11, VOLUNTEER: 7 };

    const result = await listAdminPeople({ store }, query({ page: "2", pageSize: "2" }));

    expect(store.listInputs[0]).toMatchObject({ skip: 2, take: 2, role: "DONOR" });
    expect(store.countInputs[0]).toMatchObject({ role: "DONOR", q: "" });
    expect(store.loadedRows).toEqual([donor, volunteer]);
    expect(result).toMatchObject({ counts: { DONOR: 11, VOLUNTEER: 7 }, page: 2, pageSize: 2, total: 18 });
    expect(result.people[0]).toMatchObject({
      id: donor.id,
      kind: "DONOR",
      label: "Ana's Bakery",
      title: "Ana Reyes · Ana's Bakery",
      email: "ana@example.com",
      phone: "09171234567",
      donorType: "ESTABLISHMENT",
      status: "ACTIVE",
      stats: [
        { label: "Completed donations", value: "12" },
        { label: "Portions", value: "84" },
        { label: "People served", value: "96" },
      ],
    });
    expect(result.people[1]).toMatchObject({
      kind: "VOLUNTEER",
      label: "Ben Santos",
      title: "Ben Santos",
      donorType: null,
      stats: [
        { label: "Tasks completed", value: "7" },
        { label: "Unfinished reports", value: "2" },
      ],
    });
  });

  it("uses only the fixed status label, short donation code and time in activity", async () => {
    const store = new FakePeopleStore();
    const donor = row();
    store.rows = [donor];
    store.details = {
      [donor.id]: details({
        activity: [
          {
            donationId: "12345678-1234-4234-8234-123456789012",
            toStatus: "DELIVERED",
            occurredAt: new Date("2026-11-20T01:15:00.000Z"),
          },
        ],
      }),
    };

    const result = await listAdminPeople({ store }, query());

    expect(result.people[0]?.recentActivity).toBe("Delivered #12345678 · Nov 20, 9:15 AM");
    expect(result.people[0]?.activity).toEqual(["Delivered #12345678 · Nov 20, 9:15 AM"]);
    expect(JSON.stringify(result)).not.toContain("event_note");
    expect(JSON.stringify(result)).not.toContain("metadata");
  });

  it("falls back to empty stats and no activity when a row has no details", async () => {
    const store = new FakePeopleStore();
    store.rows = [row({ businessName: null, donorType: "INDIVIDUAL" })];
    store.details = {};

    const result = await listAdminPeople({ store }, query());

    expect(result.people[0]).toMatchObject({
      label: "Ana Reyes",
      title: "Ana Reyes",
      recentActivity: "No recent activity",
      activity: [],
      stats: [
        { label: "Completed donations", value: "0" },
        { label: "Portions", value: "0" },
        { label: "People served", value: "0" },
      ],
    });
  });

  it("passes the search, status and donor type to both the page and count queries", async () => {
    const store = new FakePeopleStore();

    await listAdminPeople(
      { store },
      query({ role: "DONOR", status: "SUSPENDED", type: "INDIVIDUAL", q: "  reyes  " }),
    );

    expect(store.listInputs[0]).toMatchObject({
      role: "DONOR",
      status: "SUSPENDED",
      type: "INDIVIDUAL",
      q: "reyes",
    });
    expect(store.countInputs[0]).toEqual({
      role: "DONOR",
      status: "SUSPENDED",
      type: "INDIVIDUAL",
      q: "reyes",
    });
  });
});
