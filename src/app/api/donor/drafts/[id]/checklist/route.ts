import { NextResponse } from "next/server";
import { z } from "zod";
import { saveChecklistSchema } from "@/contracts/donation-checklist";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getChecklist, saveChecklist } from "@/server/checklist/donation-checklist";
import { prismaChecklistStore } from "@/server/checklist/prisma-checklist-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function checklistErrorResponse(error: string, fallbackMessage: string): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That draft can no longer be edited.", 409);
    case "CONSUME_BY_NOT_AFTER_PREPARED":
      return errorResponse("CONSUME_BY_NOT_AFTER_PREPARED", "The consume-by time must be after the prepared time.", 422);
    case "CONSUME_BY_NOT_AFTER_PICKUP_END":
      return errorResponse("CONSUME_BY_NOT_AFTER_PICKUP_END", "The consume-by time must be after the pickup window ends.", 422);
    default:
      return errorResponse("INTERNAL_ERROR", fallbackMessage, 500);
  }
}

export async function PUT(
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

    const parsed = saveChecklistSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The safety checklist is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    // The donor id comes from the session, never from the body: another donor's
    // draft is a NOT_FOUND for this actor.
    const result = await saveChecklist(
      { store: prismaChecklistStore },
      { donorId: actor.id, donationId: id, input: parsed.data },
    );
    if (!result.ok) return checklistErrorResponse(result.error, "The checklist could not be saved.");

    return NextResponse.json(
      { donationId: id, complete: result.complete, missing: result.missing },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Checklist save failed", { donationId, error });
    return errorResponse("INTERNAL_ERROR", "The checklist could not be saved.", 500);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: the params are not read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    const result = await getChecklist({ store: prismaChecklistStore }, { donorId: actor.id, donationId: id });
    if (!result.ok) return checklistErrorResponse(result.error, "The checklist could not be loaded.");

    return NextResponse.json(
      { checklist: result.checklist, complete: result.complete, missing: result.missing },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Checklist read failed", { donationId, error });
    return errorResponse("INTERNAL_ERROR", "The checklist could not be loaded.", 500);
  }
}
