import { z } from "zod";
import { stripMarkup } from "@/lib/plain-text";
import { AccountStatus } from "./enums";

/** The Admin's reason is saved in user_reviews.reason and emailed to the user on rejection. */
const requiredReason = z
  .string()
  .overwrite(stripMarkup)
  .min(1, "Enter a reason")
  .max(500, "Use at most 500 characters");
const optionalReason = z
  .string()
  .overwrite(stripMarkup)
  .max(500, "Use at most 500 characters")
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * One Admin decision on an account. The target user comes from the URL and the reviewer from the
 * verified session, never from the body. Reject and suspend need a reason (a database CHECK enforces it).
 */
export const reviewSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("APPROVE"), reason: optionalReason }),
  z.strictObject({ action: z.literal("REJECT"), reason: requiredReason }),
  z.strictObject({ action: z.literal("SUSPEND"), reason: requiredReason }),
  z.strictObject({ action: z.literal("REACTIVATE"), reason: optionalReason }),
]);
export type ReviewInput = z.infer<typeof reviewSchema>;
export type ReviewAction = ReviewInput["action"];

/** The user id in the URL. */
export const reviewTargetId = z.uuid("Invalid user id");

/** Which account status each action may start from, and the status it produces. */
export const REVIEW_MOVES: Record<ReviewAction, { from: AccountStatus; to: AccountStatus }> = {
  APPROVE: { from: AccountStatus.PENDING, to: AccountStatus.ACTIVE },
  REJECT: { from: AccountStatus.PENDING, to: AccountStatus.REJECTED },
  SUSPEND: { from: AccountStatus.ACTIVE, to: AccountStatus.SUSPENDED },
  REACTIVATE: { from: AccountStatus.SUSPENDED, to: AccountStatus.ACTIVE },
};

export type ReviewResult =
  | { ok: true; resultingStatus: AccountStatus; reason: string | undefined }
  | { ok: false; error: "INVALID_TRANSITION" };

/** Checks the action against the account's current status (read inside the same transaction as the update). */
export function resolveReview(input: ReviewInput, currentStatus: AccountStatus): ReviewResult {
  const move = REVIEW_MOVES[input.action];
  if (currentStatus !== move.from) return { ok: false, error: "INVALID_TRANSITION" };
  return { ok: true, resultingStatus: move.to, reason: input.reason };
}