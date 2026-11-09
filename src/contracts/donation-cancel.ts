import { z } from "zod";

/** Form inputs send "" for an empty optional reason. Trim it and drop it. */
const optionalReason = z
  .string()
  .trim()
  .max(500, "Use at most 500 characters")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * The donor's cancel body: an optional reason up to 500 characters. Nothing else
 * travels, the donor id comes from the session and the resulting status is the
 * transition's.
 */
export const cancelDonationSchema = z.strictObject({ reason: optionalReason });
export type CancelDonationInput = z.infer<typeof cancelDonationSchema>;
