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
    await expect(
      transitionDonation({ store: store("DRAFT") }, "donation-1", "REJECTED", admin, { reason: "Visible spoilage" }),
    ).resolves.toEqual({ from: "DRAFT", to: "REJECTED" });
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

describe("transitionDonation matrix", () => {
  const ALL_STATUSES: DonationStatus[] = [
    "DRAFT", "SCREENED", "POSTED", "ACCEPTED", "ASSIGNED", "PICKED_UP", "DELIVERED",
    "CLOSED", "REJECTED", "DECLINED", "REJECTED_AT_PICKUP", "CANCELLED", "EXPIRED",
  ];
  const ALLOWED_PAIRS = new Set([
    "DRAFT-SCREENED", "DRAFT-REJECTED", "SCREENED-POSTED",
    "POSTED-ACCEPTED", "POSTED-DECLINED", "POSTED-CANCELLED", "POSTED-EXPIRED",
    "ACCEPTED-ASSIGNED", "ACCEPTED-CANCELLED", "ACCEPTED-EXPIRED",
    "ASSIGNED-PICKED_UP", "ASSIGNED-REJECTED_AT_PICKUP", "ASSIGNED-CANCELLED", "ASSIGNED-EXPIRED",
    "PICKED_UP-DELIVERED", "DELIVERED-CLOSED",
  ]);
  const FORBIDDEN_PAIRS = ALL_STATUSES.flatMap((from) =>
    ALL_STATUSES.filter((to) => !ALLOWED_PAIRS.has(`${from}-${to}`)).map((to) => [from, to]),
  );

  it.each(FORBIDDEN_PAIRS)("refuses %s -> %s", async (from, to) => {
    const actor = (to as DonationStatus) === "EXPIRED" ? null : admin;
    await expect(
      transitionDonation({ store: store(from as DonationStatus) }, "donation-1", to as DonationStatus, actor, { reason: "Test reason" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  const ALLOWED_ACTORS: Array<{
    from: DonationStatus;
    to: DonationStatus;
    actors: ReadonlyArray<"ADMIN" | "DONOR" | "VOLUNTEER" | null>;
  }> = [
    { from: "DRAFT", to: "SCREENED", actors: ["ADMIN", null] },
    { from: "DRAFT", to: "REJECTED", actors: ["ADMIN", null] },
    { from: "SCREENED", to: "POSTED", actors: ["DONOR"] },
    { from: "POSTED", to: "ACCEPTED", actors: ["ADMIN"] },
    { from: "POSTED", to: "DECLINED", actors: ["ADMIN"] },
    { from: "POSTED", to: "CANCELLED", actors: ["DONOR", "ADMIN"] },
    { from: "POSTED", to: "EXPIRED", actors: [null] },
    { from: "ACCEPTED", to: "ASSIGNED", actors: ["ADMIN"] },
    { from: "ACCEPTED", to: "CANCELLED", actors: ["DONOR", "ADMIN"] },
    { from: "ACCEPTED", to: "EXPIRED", actors: [null] },
    { from: "ASSIGNED", to: "PICKED_UP", actors: ["VOLUNTEER"] },
    { from: "ASSIGNED", to: "REJECTED_AT_PICKUP", actors: ["VOLUNTEER"] },
    { from: "ASSIGNED", to: "CANCELLED", actors: ["ADMIN"] },
    { from: "ASSIGNED", to: "EXPIRED", actors: [null] },
    { from: "PICKED_UP", to: "DELIVERED", actors: ["VOLUNTEER"] },
    { from: "DELIVERED", to: "CLOSED", actors: ["VOLUNTEER"] },
  ];
  const ROLES = ["ADMIN", "DONOR", "VOLUNTEER", null] as const;
  const WRONG_ACTOR_CASES = ALLOWED_ACTORS.flatMap(({ from, to, actors }) =>
    ROLES.filter((role) => !actors.includes(role)).map((role) => [from, to, String(role)] as const),
  );

  it.each(WRONG_ACTOR_CASES)("refuses %s -> %s as %s", async (from, to, roleLabel) => {
    const role = roleLabel === "null" ? null : (roleLabel as "ADMIN" | "DONOR" | "VOLUNTEER");
    const actor: DonationActor | null = role === null ? null : { id: `${role.toLowerCase()}-1`, role };
    const fake = store(from);
    if (role === "VOLUNTEER") fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(
      transitionDonation({ store: fake }, "donation-1", to, actor, { reason: "Test reason" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" });
  });

  it("posts a screened donation only when the donor provides a QR token", async () => {
    await expect(transitionDonation({ store: store("SCREENED") }, "donation-1", "POSTED", donor))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    await expect(transitionDonation({ store: store("SCREENED") }, "donation-1", "POSTED", donor, { qrToken: "qr-token" }))
      .resolves.toEqual({ from: "SCREENED", to: "POSTED" });
  });

  it("lets the donor cancel a posted donation without a reason and the admin only with one", async () => {
    await expect(transitionDonation({ store: store("POSTED") }, "donation-1", "CANCELLED", donor))
      .resolves.toEqual({ from: "POSTED", to: "CANCELLED" });
    await expect(transitionDonation({ store: store("POSTED") }, "donation-1", "CANCELLED", admin))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    await expect(transitionDonation({ store: store("POSTED") }, "donation-1", "CANCELLED", admin, { reason: "Safety concern" }))
      .resolves.toEqual({ from: "POSTED", to: "CANCELLED" });
  });

  it("declines a posted donation only with a reason", async () => {
    await expect(transitionDonation({ store: store("POSTED") }, "donation-1", "DECLINED", admin))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    await expect(transitionDonation({ store: store("POSTED") }, "donation-1", "DECLINED", admin, { reason: "Unsafe food" }))
      .resolves.toEqual({ from: "POSTED", to: "DECLINED" });
  });

  it("assigns a volunteer only to an active one and only with the id", async () => {
    await expect(transitionDonation({ store: store("ACCEPTED") }, "donation-1", "ASSIGNED", admin))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    await expect(
      transitionDonation({ store: store("ACCEPTED") }, "donation-1", "ASSIGNED", admin, { volunteerId: "ghost-volunteer" }),
    ).rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
  });

  it("lets the system expire posted, accepted and assigned donations only after pickup_end", async () => {
    for (const from of ["POSTED", "ACCEPTED", "ASSIGNED"] as const) {
      const future = store(from, new Date(Date.now() + 60_000));
      future.donation = { ...future.donation!, currentVolunteerId: from === "ASSIGNED" ? "volunteer-1" : null };
      await expect(transitionDonation({ store: future }, "donation-1", "EXPIRED", null))
        .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
      const past = store(from, new Date(Date.now() - 1_000));
      past.donation = { ...past.donation!, currentVolunteerId: from === "ASSIGNED" ? "volunteer-1" : null };
      await expect(transitionDonation({ store: past }, "donation-1", "EXPIRED", null))
        .resolves.toEqual({ from, to: "EXPIRED" });
    }
  });

  it("rejects at pickup with a reason and writes an exit row", async () => {
    const fake = store("ASSIGNED");
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(transitionDonation({ store: fake }, "donation-1", "REJECTED_AT_PICKUP", volunteer))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    const result = await transitionDonation({ store: fake }, "donation-1", "REJECTED_AT_PICKUP", volunteer, { reason: "Packaging damaged" });
    expect(result).toEqual({ from: "ASSIGNED", to: "REJECTED_AT_PICKUP" });
    expect(fake.exits[0]).toMatchObject({ status: "REJECTED_AT_PICKUP", reason: "Packaging damaged", actorId: "volunteer-1" });
  });

  it("cancels an assigned donation only as Admin and only with a reason", async () => {
    const fake = store("ASSIGNED");
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(transitionDonation({ store: fake }, "donation-1", "CANCELLED", volunteer))
      .rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" });
    await expect(transitionDonation({ store: fake }, "donation-1", "CANCELLED", admin))
      .rejects.toMatchObject({ code: "MISSING_PAYLOAD" });
    const result = await transitionDonation({ store: fake }, "donation-1", "CANCELLED", admin, { reason: "Venue full" });
    expect(result).toEqual({ from: "ASSIGNED", to: "CANCELLED" });
    expect(fake.exits[0]).toMatchObject({ status: "CANCELLED", reason: "Venue full", actorId: "admin-1" });
  });

  it("lets the currently assigned volunteer deliver and refuses anyone else", async () => {
    const fake = store("PICKED_UP");
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(transitionDonation({ store: fake }, "donation-1", "DELIVERED", admin))
      .rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" });
    await expect(transitionDonation({ store: fake }, "donation-1", "DELIVERED", volunteer))
      .resolves.toEqual({ from: "PICKED_UP", to: "DELIVERED" });
  });

  it("closes only for the currently assigned volunteer", async () => {
    const fake = store("DELIVERED");
    fake.distributionCount = 1;
    fake.completionTotals = { portions: 10, distributed: 8, unusable: 2 };
    fake.donation = { ...fake.donation!, currentVolunteerId: "volunteer-1" };
    await expect(transitionDonation({ store: fake }, "donation-1", "CLOSED", { id: "other-volunteer", role: "VOLUNTEER" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_ACTOR" });
    await expect(transitionDonation({ store: fake }, "donation-1", "CLOSED", volunteer))
      .resolves.toEqual({ from: "DELIVERED", to: "CLOSED" });
  });

  it("answers NOT_FOUND for an unknown donation", async () => {
    const fake = store("POSTED");
    fake.donation = null;
    await expect(transitionDonation({ store: fake }, "unknown", "ACCEPTED", admin))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
