import { z } from "zod";

const MAX_NOTES = 1_000;
const MAX_COUNT = 1_000_000;

const PRIVATE_PLACE_MESSAGE =
  "Record a public distribution site or barangay area, not a home address or a person's name.";

const PRIVATE_PLACE_PATTERNS: readonly RegExp[] = [
  /\b(?:home|house|residence)\s+(?:of|address)\b/i,
  /\b(?:apartment|condo|condominium|unit|door|room)\b/i,
  /\b(?:mr|mrs|ms|miss|sir|ma'?am)\.?\s+[a-z]/i,
];

function placePrivacyIssue(place: string): string | null {
  return PRIVATE_PLACE_PATTERNS.some((pattern) => pattern.test(place))
    ? PRIVATE_PLACE_MESSAGE
    : null;
}

export function overLimitMessage(n: number, total: number): string {
  return `${n} of ${total} is not allowed. Running totals cannot exceed ${total}.`;
}

export const entryFields = {
  date: z.iso.date("Use a calendar date in YYYY-MM-DD form"),
  place: z
    .string()
    .min(1, "Record the distribution place")
    .max(200, "Use at most 200 characters")
    .refine((value) => placePrivacyIssue(value) === null, {
      message: PRIVATE_PLACE_MESSAGE,
    }),
  groupServed: z.enum([
    "families",
    "children",
    "elderly",
    "persons_with_disabilities",
    "students",
    "mixed_community",
  ]),
  peopleServed: z
    .number()
    .int("People served must be a whole number")
    .min(1, "People served must be at least 1")
    .max(MAX_COUNT),
  portionsDistributed: z
    .number()
    .int("Distributed portions must be a whole number")
    .min(1, "Distributed portions must be at least 1")
    .max(MAX_COUNT),
  portionsUnusable: z
    .number()
    .int("Unusable portions must be a whole number")
    .min(0, "Unusable portions cannot be negative")
    .max(MAX_COUNT),
  unusableReason: z.enum([
    "spoiled_on_arrival",
    "damaged",
    "other",
  ]).optional(),
  notes: z.string().max(MAX_NOTES, `Use at most ${MAX_NOTES} characters`).optional(),
} as const;

function checkCreateReason(
  value: { portionsUnusable?: number; unusableReason?: string; notes?: string },
  ctx: z.RefinementCtx,
) {
  const unusable = value.portionsUnusable;
  if (unusable !== undefined && unusable > 0 && value.unusableReason === undefined) {
    ctx.addIssue({ code: "custom", path: ["unusableReason"], message: "Choose why the portions were unusable" });
  }
  if (unusable === 0 && value.unusableReason !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unusableReason"],
      message: "Only add an unusable reason when portions are unusable",
    });
  }
  if (value.unusableReason === "other" && !value.notes) {
    ctx.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Describe what happened when the unusable reason is other",
    });
  }
}

function checkPatchReason(
  value: { portionsUnusable?: number; unusableReason?: string },
  ctx: z.RefinementCtx,
) {
  if (value.portionsUnusable === 0 && value.unusableReason !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unusableReason"],
      message: "Only add an unusable reason when portions are unusable",
    });
  }
}

export const createDistributionEntryInputSchema = z
  .strictObject({
    ...entryFields,
    portionsUnusable: entryFields.portionsUnusable.default(0),
  })
  .superRefine(checkCreateReason);

export const updateDistributionEntryInputSchema = z
  .strictObject(entryFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    path: [],
    message: "Send at least one field to update",
  })
  .superRefine(checkPatchReason);

export type CreateDistributionEntryInput = z.infer<typeof createDistributionEntryInputSchema>;
export type UpdateDistributionEntryInput = z.infer<typeof updateDistributionEntryInputSchema>;
