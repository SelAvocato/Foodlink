import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import { PLACEHOLDER_FOOD_NAME } from "./photo-step-logic";

/** The draft fields the resume decision reads, taken from the drafts list entry. */
export type ResumeDraft = {
  id: string;
  foodName: string;
  status: "DRAFT" | "SCREENED";
  foodCategoryCode: string;
};

/** The wizard step resume lands on; named like the steps the wizard already has. */
export type ResumeStep = "photo" | "checklist" | "details" | "review";

/**
 * `?draft=` arrives as string | string[] | undefined. Only a lone uuid names a
 * draft; a repeated or junk param is ignored rather than guessed at.
 */
export function parseDraftParam(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const parsed = z.uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Loose so list-only fields (dates, portions, codes) never break the read. */
const draftListItemSchema = z.looseObject({
  id: z.string(),
  foodName: z.string(),
  status: z.enum(DonationStatus),
  foodCategoryCode: z.string(),
});

/** Entries are checked one by one, so an unrelated bad entry cannot hide the wanted one. */
const draftsEnvelopeSchema = z.looseObject({
  drafts: z.array(z.unknown()),
});

const entryIdSchema = z.looseObject({ id: z.string() });

/** found it, has no such resumable draft, or could not tell (retry may help). */
export type DraftLookup =
  | { kind: "found"; draft: ResumeDraft }
  | { kind: "missing" }
  | { kind: "failed" };

/**
 * Looks `id` up in the GET /api/donor/drafts body. A body that is not the list
 * shape, or a matching entry that is malformed, is "failed" (retryable); no
 * matching id, or a status the wizard cannot resume, is "missing".
 */
export function lookupDraft(body: unknown, id: string): DraftLookup {
  const envelope = draftsEnvelopeSchema.safeParse(body);
  if (!envelope.success) return { kind: "failed" };
  for (const entry of envelope.data.drafts) {
    const withId = entryIdSchema.safeParse(entry);
    if (!withId.success || withId.data.id !== id) continue;
    const parsed = draftListItemSchema.safeParse(entry);
    if (!parsed.success) return { kind: "failed" };
    const draft = parsed.data;
    if (draft.status !== "DRAFT" && draft.status !== "SCREENED") return { kind: "missing" };
    return {
      kind: "found",
      draft: {
        id: draft.id,
        foodName: draft.foodName,
        status: draft.status,
        foodCategoryCode: draft.foodCategoryCode,
      },
    };
  }
  return { kind: "missing" };
}

/** The resumable draft for `id`, or null for every other outcome. */
export function findResumableDraft(body: unknown, id: string): ResumeDraft | null {
  const result = lookupDraft(body, id);
  return result.kind === "found" ? result.draft : null;
}

/** The whole GET checklist body is checked; loose so added fields never break it. */
const checklistResponseSchema = z.looseObject({
  checklist: z.looseObject({}).nullable(),
  complete: z.boolean(),
  missing: z.array(z.string()),
});

/** The checklist's complete flag, or null when the body is not that response. */
export function parseChecklistComplete(body: unknown): boolean | null {
  const parsed = checklistResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.complete : null;
}

const pickupResponseSchema = z.looseObject({
  pickup: z.looseObject({}).nullable(),
});

/**
 * true when a pickup window exists, false when the server reports none, null
 * when the body is not that response (missing, or not an object or null).
 */
export function parsePickupSaved(body: unknown): boolean | null {
  const parsed = pickupResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.pickup !== null;
}

/** The GET photo body, loose so added fields never break the read. */
const photoUrlResponseSchema = z.looseObject({
  url: z.string().min(1),
  expiresInSeconds: z.number(),
  mimeType: z.string(),
});

/** The signed url of an already-saved photo, or null when the body is not that response. */
export function parsePhotoUrl(body: unknown): string | null {
  const parsed = photoUrlResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.url : null;
}

/**
 * DRAFT has no photo yet, so it always restarts at step 1. SCREENED walks
 * forward: the safety checklist first, then details while the food name is
 * still the placeholder or no pickup window exists, and only then review.
 */
export function deriveResumeStep(input: {
  status: "DRAFT" | "SCREENED";
  foodName: string;
  checklistComplete: boolean;
  pickupSaved: boolean;
}): ResumeStep {
  if (input.status === "DRAFT") return "photo";
  if (!input.checklistComplete) return "checklist";
  if (input.foodName === PLACEHOLDER_FOOD_NAME || !input.pickupSaved) return "details";
  return "review";
}
