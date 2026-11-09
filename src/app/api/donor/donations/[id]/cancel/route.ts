import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelDonationSchema } from "@/contracts/donation-cancel";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";
import { cancelDonation, type CancelDonationFailure } from "@/server/cancel/cancel-donation";
import { prismaCancelStore } from "@/server/cancel/prisma-cancel-store";
import { createCancelTransition } from "@/server/cancel/cancel-transition";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function cancelErrorResponse(result: CancelDonationFailure): Response {
  switch (result.error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "NOT_CANCELLABLE":
      return errorResponse("NOT_CANCELLABLE", "This donation can no longer be cancelled.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", "The donation could not be cancelled.", 500);
  }
}

/**
 * Donor cancel (PDF: "Cancel (while POSTED or ACCEPTED)"). The generic transition
 * route is ADMIN-only, so this dedicated route cancels as the donor actor.
 */
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
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    // The body is optional: no text at all means a cancel without a reason.
    const raw = await request.text();
    let body: unknown;
    if (raw === "") {
      body = {};
    } else {
      try {
        body = JSON.parse(raw);
      } catch {
        return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
      }
    }

    const parsed = cancelDonationSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_REQUEST", "The cancel request is invalid.", 400, z.flattenError(parsed.error));
    }

    // The donor id comes from the session, never from the body.
    const result = await cancelDonation(
      { store: prismaCancelStore, transition: createCancelTransition() },
      {
        donorId: actor.id,
        donationId: id,
        ...(parsed.data.reason === undefined ? {} : { reason: parsed.data.reason }),
      },
    );
    if (!result.ok) return cancelErrorResponse(result);

    return NextResponse.json({ donationId: id, status: result.status }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // The id and the safe error summary only: never the raw message or stack.
    console.error("Cancel failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donation could not be cancelled.", 500);
  }
}
