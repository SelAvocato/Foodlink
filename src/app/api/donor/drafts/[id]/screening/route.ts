import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";
import { getScreeningProvider } from "@/server/screening/get-provider";
import { prismaScreeningStore } from "@/server/screening/prisma-screening-store";
import { screenDraftPhoto } from "@/server/screening/screen-draft-photo";
import { createScreeningTransition } from "@/server/screening/screening-transition";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the provider's or the database's. */
function screeningErrorResponse(error: string, fallbackMessage: string): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That draft can no longer be screened.", 409);
    case "REVIEW_PENDING":
      return errorResponse("REVIEW_PENDING", "Your photo is waiting for review.", 409);
    case "PHOTO_REQUIRED":
      return errorResponse("PHOTO_REQUIRED", "Upload a photo before screening.", 409);
    case "PHOTO_CHANGED":
      return errorResponse("PHOTO_CHANGED", "The photo changed during screening. Try again.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", fallbackMessage, 500);
  }
}

/** The donor's draft photo is screened; the route reads no request body at all. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor any body are read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    // The donor id comes from the session, never from the request: another
    // donor's draft is a NOT_FOUND for this actor.
    const result = await screenDraftPhoto(
      {
        store: prismaScreeningStore,
        storage: createServerStorage(),
        provider: getScreeningProvider(),
        transition: createScreeningTransition(),
      },
      { donorId: actor.id, donationId: id },
    );
    if (!result.ok) return screeningErrorResponse(result.error, "The photo could not be screened.");

    return NextResponse.json(
      {
        donationId: id,
        verdict: result.verdict,
        donationStatus: result.donationStatus,
        ...(result.donationStatus === "REJECTED" ? { reason: result.reason } : {}),
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Ids and the safe error summary only: a provider, storage or Prisma
    // message can carry the signed URL or the storage key.
    console.error("Screening failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The photo could not be screened.", 500);
  }
}
