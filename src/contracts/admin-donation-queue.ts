import { z } from "zod";
import type { DonorType } from "./enums";

/**
 * The queue query string (the route parses searchParams, so every value arrives as text).
 * limit defaults to 50. food_categories.id is a smallint identity, so a valid id is 1..32767.
 */
export const adminDonationQueueQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int("The limit must be a whole number")
    .min(1, "Use at least 1")
    .max(100, "Use at most 100")
    .default(50),
  foodCategoryId: z.coerce
    .number()
    .int("The food category id must be a whole number")
    .min(1, "The food category id must be positive")
    .max(32767, "The food category id is out of range")
    .optional(),
});
export type AdminDonationQueueQuery = z.infer<typeof adminDonationQueueQuerySchema>;

/**
 * One row of the Admin donation queue. Only these fields leave the server: never the donor's
 * email, phone or user id, never an address id, the QR token or a storage key.
 * The times are declared nullable because fn_admin_donation_queue types them so; the POSTED
 * fields CHECK in 001_schema.sql keeps posted_at, pickup_start and pickup_end set in practice.
 */
export type AdminDonationQueueItem = {
  donationId: string;
  foodName: string;
  category: string;
  portions: number;
  donorName: string;
  donorType: DonorType;
  pickupAddress: string | null;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  postedAt: Date | null;
};
