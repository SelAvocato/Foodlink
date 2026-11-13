import {
  donorDonationReportSchema,
  type DonorDonationReport,
} from "@/contracts/donor-donation-detail";

export interface DonorDonationDetailStore {
  /**
   * fn_donation_report's jsonb in DONOR mode for the donor's own donation, or null
   * when the donation does not exist, is soft-deleted or belongs to another donor
   * (the ownership check is in the same statement as the call).
   */
  findReport(donationId: string, donorId: string): Promise<unknown>;
}

export type DonorDonationDetailResult =
  | { ok: true; report: DonorDonationReport }
  | { ok: false; error: "NOT_FOUND" };

/**
 * The only two fields fn_donation_report builds for every viewer without filtering
 * them by role: note is the transition's eventNote and metadata is the transition
 * payload's metadata, so they can carry Admin notes and a volunteer id. assignments
 * and incidents are Admin-only in the function today (null for DONOR), and the
 * service deletes them so the route stays safe if the function changes. Everything
 * else stays exactly as the function built it.
 */
function withoutPrivateFields(report: DonorDonationReport): DonorDonationReport {
  const cleaned = { ...report };
  delete cleaned.assignments;
  delete cleaned.incidents;

  const timeline: unknown = cleaned.timeline;
  if (!Array.isArray(timeline)) return cleaned;
  return {
    ...cleaned,
    timeline: timeline.map((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return entry;
      return Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== "note" && key !== "metadata"),
      );
    }),
  };
}

/**
 * The donor's own donation detail. The ownership check lives in the store's SQL
 * (donor_id and deleted_at), so a missing, soft-deleted or foreign donation is the
 * same NOT_FOUND. The function does the privacy work for the DONOR viewer; this
 * service checks the minimum shape, removes the two unfiltered timeline fields,
 * deletes the Admin-only assignments and incidents keys, and passes everything else
 * through unchanged.
 */
export async function getDonorDonationDetail(
  deps: { store: DonorDonationDetailStore },
  input: { donationId: string; donorId: string },
): Promise<DonorDonationDetailResult> {
  const report = await deps.store.findReport(input.donationId, input.donorId);
  if (report === null || report === undefined) return { ok: false, error: "NOT_FOUND" };

  const parsed = donorDonationReportSchema.safeParse(report);
  if (!parsed.success || parsed.data.donation.id !== input.donationId) {
    // Not a client error: the function and this route disagree, so fail loudly as a 500.
    throw new Error("The donation report has an unexpected shape.");
  }

  return { ok: true, report: withoutPrivateFields(parsed.data) };
}
