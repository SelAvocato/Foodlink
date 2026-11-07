import "server-only";

import { donation_status } from "@/generated/prisma/enums";
import { prisma } from "@/server/db";
import type {
  DonationActor,
  TransitionDonationPayload,
} from "@/contracts/donation";
import type { DonationStatus, Role } from "@/contracts/enums";

const transitions: Record<DonationStatus, Partial<Record<DonationStatus, readonly Role[]>>> = {
  DRAFT: {
    SCREENED: ["DONOR", "ADMIN"],
    REJECTED: ["ADMIN"],
  },
  SCREENED: {
    POSTED: ["DONOR", "ADMIN"],
    REJECTED: ["ADMIN"],
  },
  POSTED: {
    ACCEPTED: ["ADMIN"],
    CANCELLED: ["DONOR", "ADMIN"],
    EXPIRED: ["ADMIN"],
  },
  ACCEPTED: {
    ASSIGNED: ["ADMIN"],
    CANCELLED: ["ADMIN"],
    EXPIRED: ["ADMIN"],
  },
  ASSIGNED: {
    PICKED_UP: ["VOLUNTEER"],
    REJECTED_AT_PICKUP: ["VOLUNTEER"],
    CANCELLED: ["ADMIN"],
    EXPIRED: ["ADMIN"],
  },
  PICKED_UP: {
    DELIVERED: ["VOLUNTEER"],
  },
  DELIVERED: {
    CLOSED: ["VOLUNTEER"],
  },
  CLOSED: {},
  REJECTED: {},
  DECLINED: {},
  REJECTED_AT_PICKUP: {},
  CANCELLED: {},
  EXPIRED: {},
};

const exitStatuses = new Set<DonationStatus>([
  "REJECTED",
  "DECLINED",
  "REJECTED_AT_PICKUP",
  "CANCELLED",
]);

export class DonationTransitionError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_TRANSITION"
      | "FORBIDDEN_ACTOR"
      | "MISSING_PAYLOAD",
    message: string,
  ) {
    super(message);
    this.name = "DonationTransitionError";
  }
}

function assertPayload(to: DonationStatus, payload: TransitionDonationPayload) {
  if (to === "POSTED" && !payload.qrToken) {
    throw new DonationTransitionError("MISSING_PAYLOAD", "A QR token is required when posting a donation");
  }
  if (to === "CLOSED" && !payload.closedAt) {
    throw new DonationTransitionError("MISSING_PAYLOAD", "A closed timestamp is required when closing a donation");
  }
  if (exitStatuses.has(to) && to !== "REJECTED" && !payload.reason?.trim()) {
    throw new DonationTransitionError("MISSING_PAYLOAD", "A reason is required for this exit status");
  }
}

function notificationContent(to: DonationStatus) {
  return {
    notificationType: `DONATION_${to}`,
    title: `Donation ${to.toLowerCase().replaceAll("_", " ")}`,
    body: `A donation changed to ${to.toLowerCase().replaceAll("_", " ")}.`,
  };
}

export async function transitionDonation(
  id: string,
  to: DonationStatus,
  actor: DonationActor,
  payload: TransitionDonationPayload = {},
): Promise<{ from: DonationStatus; to: DonationStatus }> {
  assertPayload(to, payload);

  const result = await prisma.$transaction(async (tx) => {
    const donation = await tx.donations.findUnique({
      where: { id, deleted_at: null },
      select: {
        status: true,
        donor_id: true,
        accepted_by_id: true,
      },
    });

    if (!donation) {
      throw new DonationTransitionError("NOT_FOUND", "Donation not found");
    }

    const from = donation.status as DonationStatus;
    const allowedRoles = transitions[from][to];
    if (!allowedRoles) {
      throw new DonationTransitionError(
        "INVALID_TRANSITION",
        `Cannot transition donation from ${from} to ${to}`,
      );
    }
    if (!allowedRoles.includes(actor.role)) {
      throw new DonationTransitionError(
        "FORBIDDEN_ACTOR",
        `${actor.role} cannot transition a donation from ${from} to ${to}`,
      );
    }

    const updated = await tx.donations.updateMany({
      where: { id, status: donation_status[from], deleted_at: null },
      data: {
        status: donation_status[to],
        accepted_by_id: payload.acceptedById,
        accepted_at: payload.acceptedById ? new Date() : undefined,
        closed_at: to === "CLOSED" ? payload.closedAt : undefined,
        posted_at: to === "POSTED" ? new Date() : undefined,
        qr_token: payload.qrToken,
      },
    });

    if (updated.count !== 1) {
      throw new DonationTransitionError(
        "INVALID_TRANSITION",
        "Donation changed before the transition could be completed",
      );
    }

    if (exitStatuses.has(to)) {
      await tx.donation_exits.upsert({
        where: { donation_id: id },
        create: {
          donation_id: id,
          exit_status: donation_status[to],
          actor_user_id: actor.id,
          actor_role: actor.role,
          screening_id: payload.screeningId,
          reason: payload.reason,
        },
        update: {
          exit_status: donation_status[to],
          actor_user_id: actor.id,
          actor_role: actor.role,
          screening_id: payload.screeningId,
          reason: payload.reason,
        },
      });
    }

    await tx.donation_tracking_events.create({
      data: {
        donation_id: id,
        from_status: donation_status[from],
        to_status: donation_status[to],
        actor_user_id: actor.id,
        event_note: payload.eventNote,
        metadata: payload.metadata ?? {},
      },
    });

    const recipientIds = new Set([
      donation.donor_id,
      ...(payload.notificationUserIds ?? []),
    ]);
    const content = notificationContent(to);
    await tx.notifications.createMany({
      data: [...recipientIds]
        .filter((userId) => userId !== actor.id)
        .map((userId) => ({
          user_id: userId,
          notification_type: content.notificationType,
          title: content.title,
          body: content.body,
          related_donation_id: id,
        })),
    });

    await tx.audit_logs.create({
      data: {
        actor_user_id: actor.id,
        action: "DONATION_TRANSITION",
        target_type: "DONATION",
        target_id: id,
        details: {
          from_status: from,
          to_status: to,
          ...(payload.metadata ?? {}),
        },
      },
    });

    return { from, to };
  });

  return result;
}
