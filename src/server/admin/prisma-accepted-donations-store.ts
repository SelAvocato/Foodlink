import type { AcceptedDonationsStore } from "@/server/admin/accepted-donations";
import { prisma } from "@/server/db";

/**
 * Thin adapter: ACCEPTED, non-deleted donations whose pickup end is still in the
 * future (the expiry job runs every 15 minutes, so a row can briefly be past it),
 * ordered by soonest pickup end then id for a stable list. The donor name is not
 * computed here: both donor columns come back and the service applies the
 * fn_donation_report rule.
 */
export const prismaAcceptedDonationsStore: AcceptedDonationsStore = {
  async findAcceptedDonations(now, limit) {
    const donations = await prisma.donations.findMany({
      where: { status: "ACCEPTED", deleted_at: null, pickup_end: { gt: now } },
      orderBy: [{ pickup_end: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        food_name: true,
        portions: true,
        status: true,
        pickup_end: true,
        deleted_at: true,
        users_donations_donor_idTousers: {
          select: { business_name: true, full_name: true },
        },
      },
    });

    return donations.map((donation) => ({
      donationId: donation.id,
      foodName: donation.food_name,
      portions: donation.portions,
      donorBusinessName: donation.users_donations_donor_idTousers.business_name,
      donorFullName: donation.users_donations_donor_idTousers.full_name,
      status: donation.status,
      pickupEnd: donation.pickup_end,
      deletedAt: donation.deleted_at,
    }));
  },
};
