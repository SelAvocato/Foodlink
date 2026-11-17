import { z } from "zod";
import { stripMarkup } from "@/lib/plain-text";
import { PickupDecision, ScreeningVerdict } from "./enums";

/** Form inputs may send "" for an empty reason. Strip it and drop it, like the donor cancel reason. */
const optionalReason = z
  .string()
  .overwrite(stripMarkup)
  .max(500, "Use at most 500 characters")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

function allYes(body: {
  matchesDescription: boolean;
  packagingSealedClean: boolean;
  looksSmellsNormal: boolean;
}): boolean {
  return body.matchesDescription && body.packagingSealedClean && body.looksSmellsNormal;
}

/**
 * The volunteer's three pickup answers. The client never sends the decision or the
 * volunteer id: the decision is derived from the answers and the actor comes from
 * the session. Any "no" needs a reason, because it becomes a rejection.
 */
export const pickupInspectionSchema = z
  .strictObject({
    matchesDescription: z.boolean(),
    packagingSealedClean: z.boolean(),
    looksSmellsNormal: z.boolean(),
    reason: optionalReason,
  })
  .refine((body) => !allYes(body) === (body.reason !== undefined), {
    message: "A reason is required on a no answer and only sent on a no answer",
    path: ["reason"],
  });
export type PickupInspectionInput = z.infer<typeof pickupInspectionSchema>;

/** The stored decision only; the server derives it and never trusts a client copy. */
export type VolunteerPickupInspectionResponse = {
  decision: PickupDecision;
  inspectedAt: Date;
};

export function derivePickupDecision(body: PickupInspectionInput): PickupDecision {
  return allYes(body) ? PickupDecision.ACCEPTED : PickupDecision.REJECTED;
}

/**
 * A FLAG screening blocks accepting. REVIEW does not: the AI is a visual aid and
 * the volunteer's inspection is the final gate, and pickup has no Admin review
 * queue. A malformed, timed-out or low-confidence reply therefore still leaves
 * the decision to the volunteer's three answers.
 */
export function screeningBlocksPickupAcceptance(verdict: ScreeningVerdict): boolean {
  return verdict === ScreeningVerdict.FLAG;
}
