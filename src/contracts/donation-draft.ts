import { z } from "zod";

/** Form inputs send "" for an empty optional field. Turn it into undefined so the database gets NULL. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const foodName = z.string().trim().min(1, "Enter the food name").max(160, "Use at most 160 characters");
const foodCategoryCode = z.string().trim().min(1, "Pick a food category").max(40, "Use at most 40 characters");
const portions = z
  .number()
  .int("Portions must be a whole number")
  .min(1, "Enter at least 1 portion")
  .max(100000, "Use at most 100000 portions");
const code = z.string().trim().min(1, "Codes cannot be blank").max(40, "Use at most 40 characters");
const codeList = z
  .array(code)
  .max(20, "Use at most 20 codes")
  .transform((codes) => [...new Set(codes)])
  .optional();

/**
 * A draft body carries only the food fields. Donor id, status and timestamps are
 * set by the server or the database, never sent by the client (strict rejects them).
 */
export const createDraftSchema = z.strictObject({
  foodCategoryCode,
  foodName,
  portions,
  description: optionalText(1000),
  allergenCodes: codeList,
  dietaryTagCodes: codeList,
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

/**
 * Every field is optional and at least one must be sent. Allergen and tag lists
 * replace the whole set when present (an empty array clears them) and are left
 * alone when absent. Unlike create, an empty description clears the column (null),
 * because undefined in an update means "unchanged".
 */
export const updateDraftSchema = z
  .strictObject({
    foodCategoryCode: foodCategoryCode.optional(),
    foodName: foodName.optional(),
    portions: portions.optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Use at most 1000 characters")
      .transform((value) => (value === "" ? null : value))
      .optional(),
    allergenCodes: codeList,
    dietaryTagCodes: codeList,
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Send at least one field to update",
  });
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;
