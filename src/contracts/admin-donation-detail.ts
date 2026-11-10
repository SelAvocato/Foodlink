import { z } from "zod";

/**
 * The donation id in the URL. A valid uuid is normalized to lower case, because the
 * database returns uuid values in lower case and the service compares the report's
 * donation.id with the requested id.
 */
export const adminDonationDetailId = z
  .uuid("Invalid donation id")
  .transform((value) => value.toLowerCase());

/**
 * The minimum shape of fn_donation_report's jsonb this route relies on: the donation's
 * id and status. Every other key is passed through unchanged, exactly as the function
 * builds it (snake_case keys, and the ADMIN-only fields such as names, phones and notes).
 * The function never puts the QR token or a storage key in the report, and the service
 * adds nothing to it, so neither can appear in the response.
 */
export const adminDonationReportSchema = z.looseObject({
  donation: z.looseObject({
    id: z.uuid(),
    status: z.string(),
  }),
});

export type AdminDonationReport = z.infer<typeof adminDonationReportSchema>;
