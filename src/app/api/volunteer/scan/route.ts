import { NextResponse } from "next/server";
import { pickupScanBodySchema } from "@/contracts/volunteer-scan";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import { prismaPickupScanStore } from "@/server/volunteer/prisma-pickup-scan-store";
import { resolvePickupScan } from "@/server/volunteer/token-scan";

export const runtime = "nodejs";

/**
 * Resolves the QR label's token to a donation. The label carries no donation id,
 * so the token in the body is the only lookup key and the volunteer comes from
 * the session. A PICKED_UP donation answers with the drop-off step; an ASSIGNED
 * one records the pickup scan through the existing service.
 */
export async function POST(request: Request) {
  try {
    // Role first: the body is not read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const body = await parseJsonBody(request, pickupScanBodySchema, "The scan request is invalid.");
    if (!body.ok) return body.response;

    // The volunteer id comes from the session, never from the body.
    const result = await resolvePickupScan(
      { store: prismaPickupScanStore },
      { volunteerId: actor.id, token: body.data.token },
    );
    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The QR code could not be verified.", 404);
      }
      return errorResponse("INVALID_STATE", "This donation can no longer be scanned.", 409);
    }

    return NextResponse.json(result.response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    // A safe summary only: never the token, the body, the message or the stack.
    console.error("Token scan failed", safeErrorSummary(error));
    return errorResponse("INTERNAL_ERROR", "The scan could not be recorded.", 500);
  }
}
