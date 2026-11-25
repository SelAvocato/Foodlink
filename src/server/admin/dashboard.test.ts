import { describe, expect, it } from "vitest";
import { getAdminDashboard, type AdminDashboardStore } from "./dashboard";

class FakeDashboardStore implements AdminDashboardStore {
  counts = { pending: 0, screening: 0, posted: 0, accepted: 0 };
  registrations = [] as Awaited<ReturnType<AdminDashboardStore["listRecentRegistrations"]>>;
  screenings = [] as Awaited<ReturnType<AdminDashboardStore["listRecentScreenings"]>>;
  posted = [] as Awaited<ReturnType<AdminDashboardStore["listRecentPostedDonations"]>>;
  accepted = [] as Awaited<ReturnType<AdminDashboardStore["listRecentAcceptedDonations"]>>;
  calls: unknown[] = [];

  async countPendingRegistrations() { this.calls.push("countPendingRegistrations"); return this.counts.pending; }
  async countScreeningReviews() { this.calls.push("countScreeningReviews"); return this.counts.screening; }
  async countPostedDonations() { this.calls.push("countPostedDonations"); return this.counts.posted; }
  async countAcceptedAwaitingAssignment(now: Date) { this.calls.push(["countAcceptedAwaitingAssignment", now.toISOString()]); return this.counts.accepted; }
  async listRecentRegistrations(limit: number) { this.calls.push(["listRecentRegistrations", limit]); return this.registrations; }
  async listRecentScreenings(limit: number) { this.calls.push(["listRecentScreenings", limit]); return this.screenings; }
  async listRecentPostedDonations(limit: number) { this.calls.push(["listRecentPostedDonations", limit]); return this.posted; }
  async listRecentAcceptedDonations(now: Date, limit: number) { this.calls.push(["listRecentAcceptedDonations", now.toISOString(), limit]); return this.accepted; }
}

describe("getAdminDashboard", () => {
  it("returns counts and merged recent activity with allow-listed fields", async () => {
    const store = new FakeDashboardStore();
    const now = new Date("2026-11-25T12:00:00.000Z");
    store.counts = { pending: 2, screening: 3, posted: 4, accepted: 1 };
    store.registrations = [{ id: "u1", fullName: "Ana Donor", role: "DONOR", createdAt: new Date("2026-11-25T11:00:00.000Z") }];
    store.screenings = [{ screeningId: "s1", donationId: "d1", foodName: "Bread", createdAt: new Date("2026-11-25T10:00:00.000Z") }];
    store.posted = [{ donationId: "d2", foodName: "Rice", donorName: "Bakery", postedAt: new Date("2026-11-25T09:00:00.000Z"), pickupEnd: null }];
    store.accepted = [{ donationId: "d3", foodName: "Soup", donorName: "Kitchen", pickupEnd: new Date("2026-11-25T08:00:00.000Z") }];

    const result = await getAdminDashboard({ store }, { now });

    expect(result.counts).toEqual({
      pendingRegistrations: 2,
      screeningReviews: 3,
      postedDonations: 4,
      acceptedAwaitingAssignment: 1,
    });
    expect(result.recentActivity).toHaveLength(4);
    expect(result.recentActivity[0]).toMatchObject({ type: "REGISTRATION", href: "/admin/registrations" });
    expect(result.recentActivity[3]).toMatchObject({ type: "ASSIGNMENT", href: "/admin/assignments?donation=d3" });
    for (const item of result.recentActivity) {
      expect(Object.keys(item).sort()).toEqual(["detail", "href", "id", "occurredAt", "title", "type"]);
    }
  });

  it("caps and sorts recent activity deterministically", async () => {
    const store = new FakeDashboardStore();
    const now = new Date("2026-11-25T12:00:00.000Z");
    store.registrations = Array.from({ length: 5 }, (_, i) => ({
      id: `u${i}`,
      fullName: `User ${i}`,
      role: "VOLUNTEER" as const,
      createdAt: new Date(`2026-11-25T0${i}:00:00.000Z`),
    }));
    store.screenings = Array.from({ length: 5 }, (_, i) => ({
      screeningId: `s${i}`,
      donationId: `d${i}`,
      foodName: `Food ${i}`,
      createdAt: new Date(`2026-11-24T0${i}:00:00.000Z`),
    }));

    const result = await getAdminDashboard({ store }, { now });

    expect(result.recentActivity).toHaveLength(8);
    expect(result.recentActivity[0].occurredAt >= result.recentActivity[1].occurredAt).toBe(true);
  });

  it("normalizes bad counts and skips invalid dates", async () => {
    const store = new FakeDashboardStore();
    store.counts = { pending: -1, screening: 1.5 as unknown as number, posted: Number.NaN, accepted: 2 };
    store.registrations = [{ id: "u1", fullName: "Ana", role: "DONOR", createdAt: new Date("invalid") }];

    const result = await getAdminDashboard({ store }, { now: new Date("2026-11-25T12:00:00.000Z") });

    expect(result.counts).toEqual({ pendingRegistrations: 0, screeningReviews: 0, postedDonations: 0, acceptedAwaitingAssignment: 2 });
    expect(result.recentActivity).toEqual([]);
  });
});
