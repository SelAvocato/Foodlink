import { z } from "zod";
import { missingMessages } from "./checklist-logic";
import { errorCodeFrom, messageForError } from "./photo-step-logic";

/** Submit needs the confirmation and no post already running (no double post). */
export function canSubmit(state: { confirmed: boolean; posting: boolean }): boolean {
  return state.confirmed && !state.posting;
}

/** The codes the post route returns; the server's message text is never shown. */
const POST_ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND: "The draft was not found.",
  NOT_SCREENED: "This donation has not passed the photo screening yet.",
  NOT_EDITABLE: "This donation can no longer be posted. It may already be posted.",
  PHOTO_REQUIRED: "A food photo is required before posting.",
  CHECKLIST_INCOMPLETE: "The safety checklist is not complete.",
  PICKUP_REQUIRED: "Add the pickup address and window before posting. Use Back to edit the details.",
  PICKUP_START_NOT_IN_FUTURE:
    "The pickup window must start in the future. Use Back to choose a new time.",
  CONSUME_BY_NOT_AFTER_PICKUP_END:
    "The consume-by time must be after the pickup window ends. Use Back to change the pickup window.",
};

export type PostFailure = { message: string; lines: string[] };

const missingSchema = z.looseObject({
  details: z.looseObject({ missing: z.array(z.string()) }),
});

/** The text for a failed post: from the error code only, plus the missing checklist items. */
export function postFailure(body: unknown): PostFailure {
  const code = errorCodeFrom(body);
  const message =
    code !== undefined && Object.hasOwn(POST_ERROR_MESSAGES, code)
      ? POST_ERROR_MESSAGES[code]
      : messageForError(code);
  if (code !== "CHECKLIST_INCOMPLETE") return { message, lines: [] };
  const parsed = missingSchema.safeParse(body);
  return { message, lines: parsed.success ? missingMessages(parsed.data.details.missing) : [] };
}

const postSuccessSchema = z.looseObject({
  donationId: z.string().min(1),
  status: z.literal("POSTED"),
  expiresAt: z.string().min(1),
});

/** The 200 body, or null when it is not that response (shown as the generic error). */
export function parsePostSuccess(body: unknown): { donationId: string; expiresAt: string } | null {
  const parsed = postSuccessSchema.safeParse(body);
  return parsed.success
    ? { donationId: parsed.data.donationId, expiresAt: parsed.data.expiresAt }
    : null;
}
