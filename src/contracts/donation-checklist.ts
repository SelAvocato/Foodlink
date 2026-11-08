import { z } from "zod";
import { StorageCondition } from "./enums";

/** The wizard sends a full ISO 8601 datetime with Z or a UTC offset, never a bare local time. */
const isoDateTime = z
  .iso.datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();

/**
 * One PUT sends the whole checklist. Every field is optional: anything not sent is
 * stored as null (not answered), and the confirmations are only complete when true.
 * Donor id, donation id and completed_at are set by the server, never by the body.
 */
export const saveChecklistSchema = z.strictObject({
  preparedAt: isoDateTime,
  consumeByAt: isoDateTime,
  storageCondition: z.enum(StorageCondition).optional(),
  storageTemperatureC: z
    .number()
    .min(-50, "Enter a temperature between -50 and 100")
    .max(100, "Enter a temperature between -50 and 100")
    .optional(),
  packagingIntact: z.boolean().optional(),
  allergensConfirmed: z.boolean().optional(),
  notCustomerPlateLeftovers: z.boolean().optional(),
});
export type SaveChecklistInput = z.infer<typeof saveChecklistSchema>;
