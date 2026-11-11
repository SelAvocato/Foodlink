import { NextResponse } from "next/server";
import { z } from "zod";
import { updateDraftSchema } from "@/contracts/donation-draft";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { discardDraft, updateDraft } from "@/server/drafts/donation-drafts";
import { prismaDraftStore } from "@/server/drafts/prisma-draft-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function draftErrorResponse(error: string): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That draft can no longer be edited.", 409);
    case "CATEGORY_LOCKED":
      return errorResponse("CATEGORY_LOCKED", "The food category is locked after screening.", 409);
    case "UNKNOWN_CATEGORY":
      return errorResponse("UNKNOWN_CATEGORY", "That food category does not exist.", 422);
    case "UNKNOWN_ALLERGEN":
      return errorResponse("UNKNOWN_ALLERGEN", "One or more allergen codes are unknown.", 422);
    case "UNKNOWN_DIETARY_TAG":
      return errorResponse("UNKNOWN_DIETARY_TAG", "One or more dietary tag codes are unknown.", 422);
    case "CATEGORY_NOT_ALLOWED":
      return errorResponse("CATEGORY_NOT_ALLOWED", "That food category is not allowed for your account.", 422);
    default:
      return errorResponse("INTERNAL_ERROR", "The draft request could not be completed.", 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor the body are read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    // A malformed id says nothing about which drafts exist, so it is a plain 400
    // like every other route; the service answers 404 for a missing or foreign id.
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
    }

    const parsed = updateDraftSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The draft update is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    // The donor id comes from the session, never from the body: another donor's
    // draft is a NOT_FOUND for this actor.
    const result = await updateDraft(
      { store: prismaDraftStore },
      { donorId: actor.id, donationId: id, input: parsed.data },
    );
    if (!result.ok) return draftErrorResponse(result.error);

    return NextResponse.json({ donationId: id }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Draft update failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The draft could not be updated.", 500);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    const result = await discardDraft(
      { store: prismaDraftStore },
      { donorId: actor.id, donationId: id },
    );
    if (!result.ok) return draftErrorResponse(result.error);

    return NextResponse.json({ donationId: id }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Draft discard failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The draft could not be discarded.", 500);
  }
}
