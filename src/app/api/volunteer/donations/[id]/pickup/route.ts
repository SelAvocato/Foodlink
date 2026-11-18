import { NextResponse } from "next/server";
import { z } from "zod";
import type { VolunteerPickupOutcomeResponse } from "@/contracts/volunteer-pickup-outcome";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import {
  recordPickupOutcome,
  type PickupOutcomeError,
} from "@/server/volunteer/pickup-outcome";
import { createPickupOutcomeTransition } from "@/server/volunteer/pickup-outcome-transition";
import { prismaPickupOutcomeStore } from "@/server/volunteer/prisma-pickup-outcome-store";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function pickupOutcomeErrorResponse(error: PickupOutcomeError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "INSPECTION_REQUIRED":
      return errorResponse(
        "INSPECTION_REQUIRED",
        "Complete the pickup inspection before recording the pickup.",
        409,
      );
    case "SCREENING_BLOCKED":
      return errorResponse(
        "SCREENING_BLOCKED",
        "The photo failed visual screening. Reject the pickup.",
        409,
      );
    case "INVALID_STATE":
      return errorResponse("INVALID_STATE", "This pickup was already recorded.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", "The pickup could not be recorded.", 500);
  }
}

/**
 * Applies the saved inspection: ACCEPTED marks the donation PICKED_UP, REJECTED
 * marks it REJECTED_AT_PICKUP. The outcome and the volunteer id are derived
 * server-side; the request has no body to read.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: the params are not read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const result = await recordPickupOutcome(
      {
        store: prismaPickupOutcomeStore,
        transition: createPickupOutcomeTransition(),
      },
      { volunteerId: actor.id, donationId: id },
    );
    if (!result.ok) return pickupOutcomeErrorResponse(result.error);

    const response: VolunteerPickupOutcomeResponse = {
      status: result.status,
      decision: result.decision,
    };
    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // The id and a safe summary only: never the inspection answers or reason.
    console.error("Pickup outcome failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The pickup could not be recorded.", 500);
  }
}
