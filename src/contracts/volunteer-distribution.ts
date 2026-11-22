import { z } from "zod";
import { stripMarkup, stripMarkupMultiline } from "@/lib/plain-text";
import { DonationStatus } from "./enums";

/** Beneficiary groups seeded in db/baseline/001_schema.sql, in the API's lower-case form. */
export const GroupServed = {
  FAMILIES: "families",
  CHILDREN: "children",
  ELDERLY: "elderly",
  PERSONS_WITH_DISABILITIES: "persons_with_disabilities",
  STUDENTS: "students",
  MIXED_COMMUNITY: "mixed_community",
} as const;
export type GroupServed = (typeof GroupServed)[keyof typeof GroupServed];

/** The database stores upper-case codes; the request and response use the lower-case form. */
export const GROUP_SERVED_DB_CODE: Record<GroupServed, string> = {
  families: "FAMILIES",
  children: "CHILDREN",
  elderly: "ELDERLY",
  persons_with_disabilities: "PERSONS_WITH_DISABILITIES",
  students: "STUDENTS",
  mixed_community: "MIXED_COMMUNITY",
};

export function groupServedFromDbCode(code: string): GroupServed | null {
  const value = code.toLowerCase();
  return (Object.values(GroupServed) as string[]).includes(value)
    ? (value as GroupServed)
    : null;
}

export const UnusableReason = {
  SPOILED_ON_ARRIVAL: "spoiled_on_arrival",
  DAMAGED: "damaged",
  OTHER: "other",
} as const;
export type UnusableReason = (typeof UnusableReason)[keyof typeof UnusableReason];

export const UNUSABLE_REASON_DB_CODE: Record<UnusableReason, string> = {
  spoiled_on_arrival: "SPOILED_ON_ARRIVAL",
  damaged: "DAMAGED",
  other: "OTHER",
};

export function unusableReasonFromDbCode(code: string): UnusableReason | null {
  const value = code.toLowerCase();
  return (Object.values(UnusableReason) as string[]).includes(value)
    ? (value as UnusableReason)
    : null;
}

const MAX_NOTES = 1000;
const MAX_COUNT = 1_000_000;

/**
 * RA 10173: a distribution report records a public site or barangay area only,
 * never a person's home or an individual beneficiary's name. The patterns are a
 * small heuristic, not an address parser; the database still allows any text.
 */
const PRIVATE_PLACE_PATTERNS: readonly RegExp[] = [
  /\b(?:home|house|residence)\s+(?:of|address)\b/i,
  /\b(?:apartment|condo|condominium|unit|door|room)\b/i,
  /\b(?:mr|mrs|ms|miss|sir|ma'?am)\.?\s+[a-z]/i,
];

export const PRIVATE_PLACE_MESSAGE =
  "Record a public distribution site or barangay area, not a home address or a person's name.";

export function placePrivacyIssue(place: string): string | null {
  return PRIVATE_PLACE_PATTERNS.some((pattern) => pattern.test(place))
    ? PRIVATE_PLACE_MESSAGE
    : null;
}

const optionalNotes = z
  .string()
  .overwrite(stripMarkupMultiline)
  .max(MAX_NOTES, `Use at most ${MAX_NOTES} characters`)
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const entryFields = {
  date: z.iso.date("Use a calendar date in YYYY-MM-DD form"),
  place: z
    .string()
    .overwrite(stripMarkup)
    .min(1, "Record the distribution place")
    .max(200, "Use at most 200 characters")
    .refine((value) => placePrivacyIssue(value) === null, {
      message: PRIVATE_PLACE_MESSAGE,
    }),
  groupServed: z.enum(GroupServed),
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
  unusableReason: z.enum(UnusableReason).optional(),
  notes: optionalNotes,
} as const;

function checkCreateReason(
  value: { portionsUnusable?: number; unusableReason?: UnusableReason; notes?: string },
  ctx: z.RefinementCtx,
) {
  const unusable = value.portionsUnusable;
  if (unusable !== undefined && unusable > 0 && value.unusableReason === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unusableReason"],
      message: "Choose why the portions were unusable",
    });
  }
  if (unusable === 0 && value.unusableReason !== undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["unusableReason"],
      message: "Only add an unusable reason when portions are unusable",
    });
  }
  if (value.unusableReason === UnusableReason.OTHER && !value.notes) {
    ctx.addIssue({
      code: "custom",
      path: ["notes"],
      message: "Describe what happened when the unusable reason is other",
    });
  }
}

/**
 * PATCH only rejects contradictions between fields in the same body. Whether a
 * reason or note is required depends on the stored entry, so the service checks
 * the merged entry under the donation lock.
 */
function checkPatchReason(
  value: { portionsUnusable?: number; unusableReason?: UnusableReason },
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

/**
 * One distribution entry carries both the portions handed out and the portions
 * that could not be used. The reason is required when portions are unusable and
 * refused when none are.
 */
export const createDistributionEntrySchema = z
  .strictObject({
    ...entryFields,
    portionsUnusable: entryFields.portionsUnusable.default(0),
  })
  .superRefine(checkCreateReason);
export type CreateDistributionEntryInput = z.infer<typeof createDistributionEntrySchema>;

/**
 * PATCH sends only the fields that change. The reason rules that depend on the
 * merged entry are re-checked by the service under the donation row lock.
 */
export const updateDistributionEntrySchema = z
  .strictObject(entryFields)
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    path: [],
    message: "Send at least one field to update",
  })
  .superRefine(checkPatchReason);
export type UpdateDistributionEntryInput = z.infer<typeof updateDistributionEntrySchema>;

/** The completion action has no body; the volunteer id and status come from the session and the row. */
export const completeDistributionSchema = z.strictObject({});
export type CompleteDistributionInput = z.infer<typeof completeDistributionSchema>;

export type DistributionEntryView = {
  id: string;
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason: UnusableReason | null;
  notes: string | null;
};

export type DistributionProgress = {
  /** portionsDistributed + portionsUnusable across every entry. */
  accountedPortions: number;
  totalPortions: number;
  remainingPortions: number;
};

export type DistributionEntryMutationResponse = {
  entry: DistributionEntryView;
  progress: DistributionProgress;
};

export type CompleteDistributionResponse = {
  status: typeof DonationStatus.CLOSED;
  closedAt: Date;
  progress: DistributionProgress;
};

export function progressFromTotals(
  totalPortions: number,
  portionsDistributed: number,
  portionsUnusable: number,
): DistributionProgress {
  const accountedPortions = portionsDistributed + portionsUnusable;
  return {
    accountedPortions,
    totalPortions,
    remainingPortions: totalPortions - accountedPortions,
  };
}

export function reconciliationProgress(
  totalPortions: number,
  entries: readonly Pick<
    DistributionEntryView,
    "portionsDistributed" | "portionsUnusable"
  >[],
): DistributionProgress {
  const portionsDistributed = entries.reduce(
    (total, entry) => total + entry.portionsDistributed,
    0,
  );
  const portionsUnusable = entries.reduce(
    (total, entry) => total + entry.portionsUnusable,
    0,
  );
  return progressFromTotals(totalPortions, portionsDistributed, portionsUnusable);
}
