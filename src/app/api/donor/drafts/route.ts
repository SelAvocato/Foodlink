import { NextResponse } from "next/server";
import { z } from "zod";
import { createDraftSchema } from "@/contracts/donation-draft";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { createDraft, listDrafts } from "@/server/drafts/donation-drafts";
import { prismaDraftStore } from "@/server/drafts/prisma-draft-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function draftErrorResponse(error: string): Response {
  switch (error) {
    case "DONOR_NOT_ACTIVE":
      return errorResponse("DONOR_NOT_ACTIVE", "Your donor account is not active.", 403);
    case "UNKNOWN_CATEGORY":
      return errorResponse("UNKNOWN_CATEGORY", "That food category does not exist.", 422);
    case "UNKNOWN_ALLERGEN":
      return errorResponse("UNKNOWN_ALLERGEN", "One or more allergen codes are unknown.", 422);
    case "UNKNOWN_DIETARY_TAG":
      return errorResponse("UNKNOWN_DIETARY_TAG", "One or more dietary tag codes are unknown.", 422);
    case "CATEGORY_NOT_ALLOWED":
      return errorResponse("CATEGORY_NOT_ALLOWED", "That food category is not allowed for your account.", 422);
    default:
      return errorResponse("INTERNAL_ERROR", "The draft could not be created.", 500);
  }
}

export async function POST(request: Request) {
  try {
    // Role first: nothing is read from the request before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
    }

    const parsed = createDraftSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The draft request is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    // The donor id comes from the session, never from the body.
    const result = await createDraft(
      { store: prismaDraftStore },
      { donorId: actor.id, input: parsed.data },
    );
    if (!result.ok) return draftErrorResponse(result.error);

    return NextResponse.json({ donationId: result.donationId }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Draft creation failed", { error });
    return errorResponse("INTERNAL_ERROR", "The draft could not be created.", 500);
  }
}

export async function GET() {
  try {
    const actor = await requireRole(["DONOR"]);

    const drafts = await listDrafts({ store: prismaDraftStore }, { donorId: actor.id });
    return NextResponse.json({ drafts }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Draft list failed", { error });
    return errorResponse("INTERNAL_ERROR", "The draft list could not be loaded.", 500);
  }
}
