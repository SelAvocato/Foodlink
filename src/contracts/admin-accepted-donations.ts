import { z } from "zod";

/**
 * The accepted-donation list query string (the route parses searchParams, so every
 * value arrives as text). limit defaults to 50; no other parameter exists, so the
 * pickup window filter and the order are decided by the server.
 */
export const adminAcceptedDonationsQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int("The limit must be a whole number")
    .min(1, "Use at least 1")
    .max(100, "Use at most 100")
    .default(50),
});
export type AdminAcceptedDonationsQuery = z.infer<typeof adminAcceptedDonationsQuerySchema>;

/**
 * One row of the accepted-donation list. Only these fields leave the server: never
 * the donor's contact details, an address, the QR token or a storage key.
 * pickupEnd is non-null because the list only carries rows still inside the window.
 */
export type AdminAcceptedDonationItem = {
  donationId: string;
  foodName: string;
  portions: number;
  donorName: string;
  pickupEnd: Date;
};
