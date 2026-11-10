import type { AdminDonationDetailStore } from "@/server/admin/donation-detail";
import { prisma } from "@/server/db";

type ReportRow = { report: unknown };

/**
 * Thin adapter over fn_donation_report. The viewer role is the literal ADMIN in the SQL,
 * never a value from the request, so the function returns the Admin view (names, phones
 * and notes). The function returns no row for a missing or soft-deleted donation, and a
 * NULL report is treated the same way.
 */
export const prismaDonationDetailStore: AdminDonationDetailStore = {
  async findReport(donationId) {
    // One bound parameter; the role is fixed in the SQL.
    const rows = await prisma.$queryRaw<ReportRow[]>`
      SELECT fn_donation_report(${donationId}::uuid, 'ADMIN'::user_role) AS report`;

    return rows[0]?.report ?? null;
  },
};
