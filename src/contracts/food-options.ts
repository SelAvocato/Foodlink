import { z } from "zod";
import { DonorType } from "./enums";

/**
 * The rows GET /api/donor/food-options's SQL returns from the lookup tables
 * (db/baseline/001_schema.sql). Strict on purpose: an extra column fails here,
 * so it can never be mapped into the response by accident. The SELECT never
 * names id or is_active, so neither can reach the service at all.
 */
export const foodCategoryRowSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  allowed_for_individuals: z.boolean(),
  requires_prepared_time: z.boolean(),
  requires_storage_info: z.boolean(),
});

export const allergenRowSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
});

export const dietaryTagRowSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
});

/**
 * The one-column row of users.donor_type for a live Donor. The column is nullable
 * in the schema; a null type is treated like an ESTABLISHMENT (every category),
 * mirroring assertCategoryAllowed in src/server/drafts/donation-drafts.ts.
 */
export const donorTypeRowSchema = z.strictObject({
  donor_type: z.enum(DonorType).nullable(),
});

export type FoodCategoryRow = z.infer<typeof foodCategoryRowSchema>;
export type AllergenRow = z.infer<typeof allergenRowSchema>;
export type DietaryTagRow = z.infer<typeof dietaryTagRowSchema>;

/** Response body of GET /api/donor/food-options: an allow-list with no ids; each category carries its two checklist flags. */
export type FoodOptionsResponse = {
  categories: {
    code: string;
    name: string;
    requiresPreparedTime: boolean;
    requiresStorageInfo: boolean;
  }[];
  allergens: { code: string; name: string }[];
  dietaryTags: { code: string; name: string }[];
};
