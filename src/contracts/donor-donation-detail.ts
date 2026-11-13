import { z } from "zod";

/**
 * The donation id in the URL. A valid uuid is normalized to lower case, because the
 * database returns uuid values in lower case and the service compares the report's
 * donation.id with the requested id.
 */
export const donorDonationDetailId = z
  .uuid("Invalid donation id")
  .transform((value) => value.toLowerCase());

/**
 * The minimum shape of fn_donation_report's jsonb this route relies on: the donation's
 * id and status. Every other key is passed through unchanged, exactly as the function
 * builds it for the DONOR viewer (snake_case keys), except assignments and incidents,
 * which the service deletes because they are Admin-only. The service removes note and
 * metadata from every timeline entry before the report leaves the server, because the
 * function does not filter them by role.
 */
export const donorDonationReportSchema = z.looseObject({
  donation: z.looseObject({
    id: z.uuid(),
    status: z.string(),
  }),
});

export type DonorDonationReport = z.infer<typeof donorDonationReportSchema>;
