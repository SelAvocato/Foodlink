import { z } from "zod";
import {
  allergenRowSchema,
  dietaryTagRowSchema,
  donorTypeRowSchema,
  foodCategoryRowSchema,
  type FoodOptionsResponse,
} from "@/contracts/food-options";

export interface FoodOptionsStore {
  /**
   * The donor_type row of one live Donor (users role and soft-delete checked in
   * the same statement), or null when the user is not a live Donor at all.
   */
  findDonorType(userId: string): Promise<unknown>;
  /** Active food categories in seed order (id). */
  listCategories(): Promise<unknown[]>;
  /** Active allergens in seed order (id). */
  listAllergens(): Promise<unknown[]>;
  /** Active dietary tags in seed order (id). */
  listDietaryTags(): Promise<unknown[]>;
}

export type FoodOptionsResult =
  | { ok: true; options: FoodOptionsResponse }
  | { ok: false; error: "NOT_FOUND" };

/**
 * Reference data for the donate wizard (categories with their two checklist
 * flags, allergens, dietary tags). The database is the single source: the same
 * category flags drive fn_assert_checklist_rules, so the browser must not keep
 * its own copy. The user id is the session actor's, passed in by the route; a
 * missing row is an expected NOT_FOUND, while a row that does not match the
 * schema means the SQL and the contract disagree, which is a bug and fails
 * loudly as a 500. INDIVIDUAL donors only see the categories allowed for them
 * (mirrors assertCategoryAllowed); ESTABLISHMENT and a null donor type see all
 * active categories. The store order is kept, and every output field is mapped
 * explicitly, so no id or is_active can ride along.
 */
export async function getFoodOptions(
  deps: { store: FoodOptionsStore },
  input: { userId: string },
): Promise<FoodOptionsResult> {
  const donorTypeRow = await deps.store.findDonorType(input.userId);
  if (donorTypeRow === null || donorTypeRow === undefined) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const parsedDonorType = donorTypeRowSchema.safeParse(donorTypeRow);
  if (!parsedDonorType.success) {
    // Not a client error: a value the SQL should never return did.
    throw new Error("The donor type row has an unexpected shape.");
  }

  const parsedCategories = z
    .array(foodCategoryRowSchema)
    .safeParse(await deps.store.listCategories());
  if (!parsedCategories.success) {
    throw new Error("A food category row has an unexpected shape.");
  }

  const parsedAllergens = z.array(allergenRowSchema).safeParse(await deps.store.listAllergens());
  if (!parsedAllergens.success) {
    throw new Error("An allergen row has an unexpected shape.");
  }

  const parsedDietaryTags = z
    .array(dietaryTagRowSchema)
    .safeParse(await deps.store.listDietaryTags());
  if (!parsedDietaryTags.success) {
    throw new Error("A dietary tag row has an unexpected shape.");
  }

  const individualOnly = parsedDonorType.data.donor_type === "INDIVIDUAL";

  return {
    ok: true,
    options: {
      categories: parsedCategories.data
        .filter((row) => !individualOnly || row.allowed_for_individuals)
        .map((row) => ({
          code: row.code,
          name: row.name,
          requiresPreparedTime: row.requires_prepared_time,
          requiresStorageInfo: row.requires_storage_info,
        })),
      allergens: parsedAllergens.data.map((row) => ({
        code: row.code,
        name: row.name,
      })),
      dietaryTags: parsedDietaryTags.data.map((row) => ({
        code: row.code,
        name: row.name,
      })),
    },
  };
}
