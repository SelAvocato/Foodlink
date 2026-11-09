import { NextResponse } from "next/server";
import { z } from "zod";
import { postDonationSchema } from "@/contracts/donation-post";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";
import { postDonation, type PostDonationFailure } from "@/server/posting/post-donation";
import { prismaPostingStore } from "@/server/posting/prisma-posting-store";
import { createPostTransition } from "@/server/posting/post-transition";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function postErrorResponse(result: PostDonationFailure, fallbackMessage: string): Response {
  switch (result.error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_SCREENED":
      return errorResponse("NOT_SCREENED", "Photo screening must pass before posting.", 409);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That donation can no longer be posted.", 409);
    case "PHOTO_REQUIRED":
      return errorResponse("PHOTO_REQUIRED", "Upload a photo before posting.", 409);
    case "CHECKLIST_INCOMPLETE":
      return errorResponse("CHECKLIST_INCOMPLETE", "Complete the safety checklist before posting.", 422, {
        missing: result.missing,
      });
    case "PICKUP_REQUIRED":
      return errorResponse("PICKUP_REQUIRED", "Set the pickup address and window before posting.", 422);
    case "PICKUP_START_NOT_IN_FUTURE":
      return errorResponse("PICKUP_START_NOT_IN_FUTURE", "The pickup window must start in the future.", 422);
    case "CONSUME_BY_NOT_AFTER_PICKUP_END":
      return errorResponse("CONSUME_BY_NOT_AFTER_PICKUP_END", "The pickup window must end before the consume-by time.", 422);
    default:
      return errorResponse("INTERNAL_ERROR", fallbackMessage, 500);
  }
}

export async function POST(
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

    // Only the confirmation travels: the checks, the QR token and the expiry
    // are the server's, so parsed.data is not passed to the service.
    const parsed = postDonationSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_REQUEST", "The post request is invalid.", 400, z.flattenError(parsed.error));
    }

    // The donor id comes from the session, never from the body: another donor's
    // draft is a NOT_FOUND for this actor.
    const result = await postDonation(
      { store: prismaPostingStore, transition: createPostTransition() },
      { donorId: actor.id, donationId: id },
    );
    if (!result.ok) return postErrorResponse(result, "The donation could not be posted.");

    // The QR token never appears here: only the label read route will show it.
    return NextResponse.json(
      { donationId: id, status: "POSTED", expiresAt: result.expiresAt },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Ids and the safe error summary only: a Prisma or storage message can
    // carry the QR token, the storage key or the signed URL.
    console.error("Posting failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donation could not be posted.", 500);
  }
}
