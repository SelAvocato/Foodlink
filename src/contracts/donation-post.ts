import { z } from "zod";

/**
 * The donor confirms the wizard step ("this information is true"). Nothing else
 * comes from the client: the checks, the QR token and the expiry are the server's.
 */
export const postDonationSchema = z.strictObject({ confirmed: z.literal(true) });
export type PostDonationInput = z.infer<typeof postDonationSchema>;
