import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";
import { getQrLabel } from "@/server/qr/get-qr-label";
import { prismaQrStore } from "@/server/qr/prisma-qr-store";

export const runtime = "nodejs";

/**
 * The donor's QR label while the donation is POSTED, ACCEPTED or ASSIGNED: the
 * only response that ever carries a QR token. no-store keeps it out of every
 * cache, and the token is never logged.
 */
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
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    // The donor id comes from the session, so another donor's token is a NOT_FOUND.
    const result = await getQrLabel({ store: prismaQrStore }, { donorId: actor.id, donationId: id });
    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The donation was not found.", 404);
      }
      return errorResponse("NOT_AVAILABLE", "The QR label is no longer available.", 409);
    }

    return NextResponse.json(
      { donationId: id, status: result.status, qrToken: result.qrToken },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Id and safe summary only: an error message can contain the QR token.
    console.error("QR label read failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The QR label could not be read.", 500);
  }
}
