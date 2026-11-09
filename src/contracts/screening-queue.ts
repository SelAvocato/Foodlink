import { z } from "zod";
import type { StorageCondition } from "./enums";

/** The Admin queue query: one optional limit, nothing else may appear. */
export const screeningQueueQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ScreeningQueueQuery = z.infer<typeof screeningQueueQuerySchema>;

/** The donor's checklist fields as stored, or null when no checklist was saved yet. */
export type ScreeningQueueChecklist = {
  preparedAt: Date | null;
  consumeByAt: Date | null;
  storageCondition: StorageCondition | null;
  storageTemperatureC: number | null;
  packagingIntact: boolean | null;
  allergensConfirmed: boolean | null;
  notCustomerPlateLeftovers: boolean | null;
  completedAt: Date | null;
};

/**
 * One pending review case for the Admin: the screening, the food the donor
 * described, the checklist and a short-lived signed photo URL. Never the donor's
 * email, phone, address or user id, and never the storage key — photoUrl is the
 * only place a link appears and it lives in this response only.
 */
export type ScreeningQueueItem = {
  screeningId: string;
  donationId: string;
  createdAt: Date;
  confidence: number | null;
  signs: string[];
  notes: string | null;
  donation: {
    foodName: string;
    portions: number;
    categoryCode: string;
  };
  checklist: ScreeningQueueChecklist | null;
  photoUrl: string | null;
};
