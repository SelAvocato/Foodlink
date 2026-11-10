import {
  adminDonationReportSchema,
  type AdminDonationReport,
} from "@/contracts/admin-donation-detail";

export interface AdminDonationDetailStore {
  /**
   * fn_donation_report's jsonb in ADMIN mode, or null when the donation does not exist
   * or is soft-deleted (the function returns no row then).
   */
  findReport(donationId: string): Promise<unknown>;
}

export type AdminDonationDetailResult =
  | { ok: true; report: AdminDonationReport }
  | { ok: false; error: "NOT_FOUND" };

/**
 * Admin-wide read, so there is no ownership check here: the route has already verified
 * the Admin role. The function does the privacy work for the ADMIN viewer; this service
 * only checks the minimum shape and returns the report untouched.
 */
export async function getAdminDonationDetail(
  deps: { store: AdminDonationDetailStore },
  input: { donationId: string },
): Promise<AdminDonationDetailResult> {
  const report = await deps.store.findReport(input.donationId);
  if (report === null || report === undefined) return { ok: false, error: "NOT_FOUND" };

  const parsed = adminDonationReportSchema.safeParse(report);
  if (!parsed.success || parsed.data.donation.id !== input.donationId) {
    // Not a client error: the function and this route disagree, so fail loudly as a 500.
    throw new Error("The donation report has an unexpected shape.");
  }

  return { ok: true, report: parsed.data };
}
