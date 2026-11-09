import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: {} }));
import type { DonationActor, TransitionStore, TransitionTx } from "@/contracts/donation";
import type { DonationStatus } from "@/contracts/enums";
import {
  DonationTransitionError,
  transitionDonation,
} from "./transition-donation";

class FakeStore implements TransitionStore {
  donation: {
    status: DonationStatus;
    donorId: string;
    pickupEnd: Date | null;
    currentVolunteerId: string | null;
  } | null = null;
  activeVolunteers = new Set<string>();
  distributionCount = 0;
  completionTotals = { portions: 10, distributed: 10, unusable: 0 };
  forceUpdateFailure = false;
  updates: unknown[] = [];
  assignments: unknown[] = [];
  exits: unknown[] = [];
  tracking: unknown[] = [];
  notifications: unknown[] = [];
  audits: unknown[] = [];

  async transaction<T>(work: (tx: TransitionTx) => Promise<T>): Promise<T> {
    return work({
      getDonation: async () => this.donation,
      updateDonation: async (input) => {
        if (this.forceUpdateFailure) return false;
        if (!this.donation || this.donation.status !== input.from) return false;
        this.donation = { ...this.donation, status: input.to };
        this.updates.push(input);
        return true;
      },
      getActiveVolunteer: async (id) =>
        this.activeVolunteers.has(id) ? { id, role: "VOLUNTEER", status: "ACTIVE" } : null,
      hasDistribution: async () => this.distributionCount > 0,
      getCompletionTotals: async () => this.completionTotals,
      insertAssignment: async (row) => { this.assignments.push(row); },
      insertExit: async (row) => { this.exits.push(row); },
      insertTracking: async (row) => { this.tracking.push(row); },
      insertNotifications: async (rows) => { this.notifications.push(...rows); },
      insertAudit: async (row) => { this.audits.push(row); },
    });
  }
}

const admin: DonationActor = { id: "admin-1", role: "ADMIN" };
const donor: DonationActor = { id: "donor-1", role: "DONOR" };
const volunteer: DonationActor = { id: "volunteer-1", role: "VOLUNTEER" };

function store(status: DonationStatus, pickupEnd = new Date(Date.now() + 60_000)) {
  const result = new FakeStore();
  result.donation = { status, donorId: "donor-1", pickupEnd, currentVolunteerId: null };
  return result;
}

describe("transitionDonation", () => {
  it("allows an Admin to decline a posted donation with a reason", async () => {
    const fake = store("POSTED");
    const result = await transitionDonation({ store: fake }, "donation-1", "DECLINED", admin, { reason: "Unsafe food" });
    expect(result).toEqual({ from: "POSTED", to: "DECLINED" });
    expect(fake.exits[0]).toMatchObject({ status: "DECLINED", reason: "Unsafe food", actorId: "admin-1" });
  });

  it("requires the donor to own donor transitions and only requires cancellation reasons for Admins", async () => {
    const fake = store("ACCEPTED");
    await expect(
      transitionDonation({ store: fake }, "donation-1", "CANCELLED", { id: "other", role: "DONOR" }),
    ).rejects.toMatchObject<Partial<DonationTransitionError>>({ code: "FORBIDDEN_ACTOR" });
    const result = await transitionDonation({ store: fake }, "donation-1", "CANCELLED", donor);
    expect(result.to).toBe("CANCELLED");
  });

  it("accepts only inside the pickup window and records the actor as accepter", async () => {
    const fake = store("POSTED");
    await transitionDonation({ store: fake }, "donation-1", "ACCEPTED", admin);
    expect(fake.updates[0]).toMatchObject({ actorId: "admin-1" });
    const expired = store("POSTED", new Date(Date.now() - 1_000));
    await expect(transitionDonation({ store: expired }, "donation-1", "ACCEPTED", admin))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("creates an assignment only for an active volunteer", async () => {
    const fake = store("ACCEPTED");
    fake.activeVolunteers.add("volunteer-1");
    const result = await transitionDonation(
      { store: fake },
      "donation-1",
      "ASSIGNED",
      admin,
      { volunteerId: "volunteer-1" },
    );
    expect(result.to).toBe("ASSIGNED");
    expect(fake.assignments).toHaveLength(1);
  });

  it("requires the currently assigned volunteer for pickup moves", async () => {
    const fake = store("ASSIGNED");
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(
      transitionDonation({ store: fake }, "donation-1", "PICKED_UP", { id: "other", role: "VOLUNTEER" }),
    ).rejects.toMatchObject<Partial<DonationTransitionError>>({ code: "FORBIDDEN_ACTOR" });
    await expect(
      transitionDonation({ store: fake }, "donation-1", "PICKED_UP", volunteer),
    ).resolves.toEqual({ from: "ASSIGNED", to: "PICKED_UP" });
  });

  it("allows system expiry only after pickup_end", async () => {
    const fake = store("POSTED", new Date(Date.now() - 1_000));
    await expect(
      transitionDonation({ store: fake }, "donation-1", "EXPIRED", null),
    ).resolves.toEqual({ from: "POSTED", to: "EXPIRED" });
  });

  it("allows the screening system to move a draft to SCREENED or REJECTED", async () => {
    await expect(transitionDonation({ store: store("DRAFT") }, "donation-1", "SCREENED", null))
      .resolves.toEqual({ from: "DRAFT", to: "SCREENED" });
    await expect(transitionDonation({ store: store("DRAFT") }, "donation-1", "REJECTED", null))
      .resolves.toEqual({ from: "DRAFT", to: "REJECTED" });
  });

  it("allows an Admin to pass or reject a draft screening", async () => {
    await expect(transitionDonation({ store: store("DRAFT") }, "donation-1", "SCREENED", admin))
      .resolves.toEqual({ from: "DRAFT", to: "SCREENED" });
    await expect(transitionDonation({ store: store("DRAFT") }, "donation-1", "REJECTED", admin))
      .resolves.toEqual({ from: "DRAFT", to: "REJECTED" });
  });

  it("requires a distribution row before closing", async () => {
    const fake = store("DELIVERED");
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(transitionDonation({ store: fake }, "donation-1", "CLOSED", volunteer))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    fake.distributionCount = 1;
    fake.completionTotals = { portions: 10, distributed: 8, unusable: 2 };
    await expect(transitionDonation({ store: fake }, "donation-1", "CLOSED", volunteer))
      .resolves.toEqual({ from: "DELIVERED", to: "CLOSED" });
    const mismatch = store("DELIVERED");
    mismatch.donation = { ...mismatch.donation!, currentVolunteerId: "volunteer-1" };
    mismatch.distributionCount = 1;
    mismatch.completionTotals = { portions: 10, distributed: 9, unusable: 0 };
    await expect(transitionDonation({ store: mismatch }, "donation-1", "CLOSED", volunteer))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
  });

  it("preserves audit transition fields over metadata", async () => {
    const fake = store("POSTED");
    await transitionDonation({ store: fake }, "donation-1", "DECLINED", admin, {
      reason: "Unsafe food",
      metadata: { from_status: "tampered", to_status: "tampered" },
    });
    expect(fake.audits[0]).toMatchObject({ details: { from_status: "POSTED", to_status: "DECLINED" } });
  });

  it("reports a race when the conditional update changes no rows", async () => {
    const fake = store("POSTED");
    fake.forceUpdateFailure = true;
    await expect(transitionDonation({ store: fake }, "donation-1", "DECLINED", admin, { reason: "Unsafe food" }))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(fake.exits).toHaveLength(0);
  });
});
