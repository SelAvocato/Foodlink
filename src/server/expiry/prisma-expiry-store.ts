import "server-only";

import { prisma } from "@/server/db";
import type { DonationStatus } from "@/contracts/enums";
import type { DueDonationStore, ExpiryTransition } from "@/server/expiry/expire-due-donations";
import { prismaTransitionStore, transitionDonation } from "@/server/donations/transition-donation";

export const prismaExpiryStore: DueDonationStore = {
  async listDue(limit) {
    const rows = await prisma.$queryRaw<Array<{ donation_id: string; status: string; pickup_end: Date }>>`
      SELECT donation_id, status::text AS status, pickup_end
      FROM fn_donations_due_for_expiry(${limit})
    `;
    return rows.map((row) => ({
      donationId: row.donation_id,
      status: row.status as DonationStatus,
      pickupEnd: row.pickup_end,
    }));
  },
};

export const prismaExpiryTransition: ExpiryTransition = (id, to, actor, payload) =>
  transitionDonation({ store: prismaTransitionStore }, id, to, actor, payload);
