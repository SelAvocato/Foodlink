import type { DonorDonationDetailStore } from "@/server/donor/donation-detail";
import { prisma } from "@/server/db";

type ReportRow = { report: unknown };

/**
 * Thin adapter over fn_donation_report. The viewer role is the literal DONOR in the
 * SQL, never a value from the request. The EXISTS clause is the ownership check: the
 * donation must exist, belong to this donor and not be soft-deleted, so a missing,
 * foreign or discarded donation returns no row at all. The function itself does not
 * check who the caller is, which is why the check sits in this statement.
 */
export const prismaDonationDetailStore: DonorDonationDetailStore = {
  async findReport(donationId, donorId) {
    // Two bound parameters; the role is fixed in the SQL.
    const rows = await prisma.$queryRaw<ReportRow[]>`
      SELECT fn_donation_report(${donationId}::uuid, 'DONOR'::user_role) AS report
      WHERE EXISTS (
        SELECT 1 FROM donations d
        WHERE d.id = ${donationId}::uuid AND d.donor_id = ${donorId}::uuid AND d.deleted_at IS NULL
      )`;

    return rows[0]?.report ?? null;
  },
};
