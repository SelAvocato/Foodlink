import { NextResponse } from "next/server";
import { z } from "zod";
import { dropoffScanBodySchema } from "@/contracts/volunteer-dropoff";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import { recordDropoffScan } from "@/server/volunteer/dropoff-scan";
import { createDropoffTransition } from "@/server/volunteer/dropoff-transition";
import { prismaDropoffScanStore } from "@/server/volunteer/prisma-dropoff-scan-store";

export const runtime = "nodejs";

/**
 * Records the DROPOFF scan for the donation in the URL and marks it DELIVERED.
 * The token comes from the body so it never reaches a proxy log or the browser
 * history, and the volunteer comes from the session. A repeat after delivery
 * answers 200 with alreadyScanned: true.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor the body are read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const body = await parseJsonBody(request, dropoffScanBodySchema, "The scan request is invalid.");
    if (!body.ok) return body.response;

    // The volunteer id comes from the session, never from the body.
    const result = await recordDropoffScan(
      { store: prismaDropoffScanStore, transition: createDropoffTransition() },
      { volunteerId: actor.id, donationId: id, token: body.data.token },
    );
    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The donation was not found.", 404);
      }
      return errorResponse("INVALID_STATE", "This donation can no longer be delivered.", 409);
    }

    return NextResponse.json(result.response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    // The id and a safe summary only: never the token, message or stack.
    console.error("Drop-off scan failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The drop-off could not be recorded.", 500);
  }
}
