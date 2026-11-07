import "server-only";

import { donation_status } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import type {
  DonationActor,
  TransitionDonationPayload,
  TransitionStore,
  TransitionTx,
} from "@/contracts/donation";
import type { DonationStatus, Role } from "@/contracts/enums";

const transitions: Record<DonationStatus, Partial<Record<DonationStatus, readonly Role[]>>> = {
  DRAFT: { SCREENED: ["DONOR", "ADMIN"], REJECTED: ["ADMIN"] },
  SCREENED: { POSTED: ["DONOR", "ADMIN"], REJECTED: ["ADMIN"] },
  POSTED: { ACCEPTED: ["ADMIN"], DECLINED: ["ADMIN"], CANCELLED: ["DONOR", "ADMIN"], EXPIRED: [] },
  ACCEPTED: { ASSIGNED: ["ADMIN"], CANCELLED: ["DONOR", "ADMIN"], EXPIRED: [] },
  ASSIGNED: { PICKED_UP: ["VOLUNTEER"], REJECTED_AT_PICKUP: ["VOLUNTEER"], CANCELLED: ["ADMIN"], EXPIRED: [] },
  PICKED_UP: { DELIVERED: ["VOLUNTEER"] },
  DELIVERED: { CLOSED: ["VOLUNTEER"] },
  CLOSED: {}, REJECTED: {}, DECLINED: {}, REJECTED_AT_PICKUP: {}, CANCELLED: {}, EXPIRED: {},
};

const exits = new Set<DonationStatus>(["REJECTED", "DECLINED", "REJECTED_AT_PICKUP", "CANCELLED"]);

export class DonationTransitionError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" | "MISSING_PAYLOAD",
    message: string,
  ) {
    super(message);
    this.name = "DonationTransitionError";
  }
}

function requireReason(to: DonationStatus, actor: DonationActor | null, reason?: string) {
  if (to === "DECLINED" || to === "REJECTED_AT_PICKUP" || (to === "CANCELLED" && actor?.role === "ADMIN")) {
    if (!reason?.trim()) throw new DonationTransitionError("MISSING_PAYLOAD", "A reason is required");
  }
}

export async function transitionDonation(
  deps: { store: TransitionStore },
  id: string,
  to: DonationStatus,
  actor: DonationActor | null,
  payload: TransitionDonationPayload = {},
): Promise<{ from: DonationStatus; to: DonationStatus }> {
  if (to === "EXPIRED" && actor) {
    throw new DonationTransitionError("FORBIDDEN_ACTOR", "Expiry is performed by the system");
  }
  requireReason(to, actor, payload.reason);

  return deps.store.transaction(async (tx) => {
    const donation = await tx.getDonation(id);
    if (!donation) throw new DonationTransitionError("NOT_FOUND", "Donation not found");
    const from = donation.status;
    const roles = transitions[from][to];
    if (!roles) throw new DonationTransitionError("INVALID_TRANSITION", `Cannot transition ${from} to ${to}`);
    if (to !== "EXPIRED" && (!actor || !roles.includes(actor.role))) {
      throw new DonationTransitionError("FORBIDDEN_ACTOR", "Actor cannot perform this transition");
    }
    if (to === "EXPIRED" && (!donation.pickupEnd || donation.pickupEnd > new Date())) {
      throw new DonationTransitionError("INVALID_TRANSITION", "Donation is not due for expiry");
    }
    if (actor?.role === "DONOR" && donation.donorId !== actor.id) {
      throw new DonationTransitionError("FORBIDDEN_ACTOR", "Donor does not own this donation");
    }
    if (actor?.role === "VOLUNTEER" && donation.currentVolunteerId !== actor.id) {
      throw new DonationTransitionError("FORBIDDEN_ACTOR", "Volunteer is not assigned to this donation");
    }
    if (to === "POSTED" && !payload.qrToken) {
      throw new DonationTransitionError("MISSING_PAYLOAD", "A QR token is required when posting");
    }
    if (to === "ASSIGNED" && !payload.volunteerId) {
      throw new DonationTransitionError("MISSING_PAYLOAD", "A volunteer is required when assigning");
    }
    if (to === "CLOSED" && !payload.hasDistribution) {
      throw new DonationTransitionError("MISSING_PAYLOAD", "A distribution record is required when closing");
    }
    if (to === "ACCEPTED" && (!donation.pickupEnd || donation.pickupEnd <= new Date())) {
      throw new DonationTransitionError("INVALID_TRANSITION", "Donation pickup window has passed");
    }
    const now = new Date();
    const updated = await tx.updateDonation({
      id, from, to, now, actorId: actor?.id ?? null,
      closedAt: to === "CLOSED" ? now : null,
      qrToken: to === "POSTED" ? payload.qrToken ?? null : null,
    });
    if (!updated) throw new DonationTransitionError("INVALID_TRANSITION", "Donation changed before transition completed");
    if (to === "ASSIGNED") {
      const volunteer = await tx.getActiveVolunteer(payload.volunteerId!);
      if (!volunteer) throw new DonationTransitionError("MISSING_PAYLOAD", "Volunteer must be ACTIVE");
      await tx.insertAssignment({ donationId: id, volunteerId: volunteer.id, assignedById: actor!.id, assignedAt: now });
    }
    if (exits.has(to)) {
      await tx.insertExit({ donationId: id, status: to, actorId: actor?.id ?? null, actorRole: actor?.role ?? null, reason: payload.reason ?? null, screeningId: payload.screeningId });
    }
    await tx.insertTracking({ donationId: id, from, to, actorId: actor?.id ?? null, note: payload.eventNote, metadata: { ...(payload.metadata ?? {}), from_status: from, to_status: to } });
    const recipients = [donation.donorId, ...(payload.notificationUserIds ?? [])].filter((userId) => userId !== actor?.id);
    await tx.insertNotifications(recipients.map((userId) => ({ userId, type: `DONATION_${to}`, title: `Donation ${to.toLowerCase()}`, body: `Donation changed to ${to.toLowerCase()}.`, donationId: id })));
    await tx.insertAudit({ actorId: actor?.id ?? null, targetId: id, details: { from_status: from, to_status: to, ...(payload.metadata ?? {}) } });
    return { from, to };
  });
}

export const prismaTransitionStore: TransitionStore = {
  transaction: (work) => prisma.$transaction(async (tx) => {
    const adapter: TransitionTx = {
      async getDonation(id) {
        const row = await tx.donations.findUnique({ where: { id, deleted_at: null }, select: { status: true, donor_id: true, pickup_end: true, donation_assignments: { where: { ended_at: null }, select: { volunteer_id: true } } } });
        return row ? { status: row.status, donorId: row.donor_id, pickupEnd: row.pickup_end, currentVolunteerId: row.donation_assignments?.volunteer_id ?? null } : null;
      },
      async updateDonation(input) {
        const data = {
          status: donation_status[input.to],
          accepted_by_id: input.to === "ACCEPTED" ? input.actorId : undefined,
          accepted_at: input.to === "ACCEPTED" ? input.now : undefined,
          posted_at: input.to === "POSTED" ? input.now : undefined,
          qr_token: input.to === "POSTED" ? input.qrToken : undefined,
          closed_at: input.closedAt,
        };
        const where = { id: input.id, status: donation_status[input.from], deleted_at: null, ...(input.to === "ACCEPTED" ? { pickup_end: { gt: input.now } } : {}) };
        return (await tx.donations.updateMany({ where, data })).count === 1;
      },
      async getActiveVolunteer(id) {
        const row = await tx.users.findFirst({ where: { id, role: "VOLUNTEER", status: "ACTIVE", deleted_at: null }, select: { id: true } });
        return row ? { id: row.id, role: "VOLUNTEER", status: "ACTIVE" } : null;
      },
      async insertAssignment(input) { await tx.donation_assignments.create({ data: { donation_id: input.donationId, volunteer_id: input.volunteerId, assigned_by_id: input.assignedById, assigned_at: input.assignedAt } }); },
      async insertExit(input) { await tx.donation_exits.create({ data: { donation_id: input.donationId, exit_status: donation_status[input.status], actor_user_id: input.actorId, actor_role: input.actorRole, reason: input.reason, screening_id: input.screeningId } }); },
      async insertTracking(input) { await tx.donation_tracking_events.create({ data: { donation_id: input.donationId, from_status: donation_status[input.from], to_status: donation_status[input.to], actor_user_id: input.actorId, event_note: input.note, metadata: input.metadata } }); },
      async insertNotifications(rows) { await tx.notifications.createMany({ data: rows.map((row) => ({ user_id: row.userId, notification_type: row.type, title: row.title, body: row.body, related_donation_id: row.donationId })) }); },
      async insertAudit(input) { await tx.audit_logs.create({ data: { actor_user_id: input.actorId, action: "DONATION_TRANSITION", target_type: "DONATION", target_id: input.targetId, details: input.details } }); },
    };
    return work(adapter);
  }),
};
