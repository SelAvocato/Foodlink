import { z } from "zod";
import { addressSchema } from "./registration";

/** The wizard sends a full ISO 8601 datetime with Z or a UTC offset, never a bare local time. */
const isoDateTime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

/**
 * One PUT replaces the whole pickup: address, start and end together, because
 * donations_pickup_all_or_none requires all three or none. Donor id and
 * donation id are set by the server, never by the body.
 */
export const savePickupSchema = z
  .strictObject({
    address: addressSchema,
    pickupStart: isoDateTime,
    pickupEnd: isoDateTime,
  })
  .refine((body) => body.pickupEnd > body.pickupStart, {
    message: "The pickup window must end after it starts",
    path: ["pickupEnd"],
  });
export type SavePickupInput = z.infer<typeof savePickupSchema>;
