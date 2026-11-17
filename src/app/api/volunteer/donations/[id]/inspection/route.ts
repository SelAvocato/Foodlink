import { NextResponse } from "next/server";
import { z } from "zod";
import {
  pickupInspectionSchema,
  type VolunteerPickupInspectionResponse,
} from "@/contracts/volunteer-pickup-inspection";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import {
  savePickupInspection,
  type PickupInspectionError,
} from "@/server/volunteer/pickup-inspection";
import { prismaPickupInspectionStore } from "@/server/volunteer/prisma-pickup-inspection-store";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function inspectionErrorResponse(error: PickupInspectionError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "SCAN_REQUIRED":
      return errorResponse("SCAN_REQUIRED", "Scan the donation label before the inspection.", 409);
    case "PHOTO_REQUIRED":
      return errorResponse("PHOTO_REQUIRED", "Add the pickup photo before the inspection.", 409);
    case "SCREENING_BLOCKED":
      return errorResponse(
        "SCREENING_BLOCKED",
        "The photo failed visual screening. Reject the pickup or retake the photo.",
        409,
      );
    case "INVALID_STATE":
      return errorResponse("INVALID_STATE", "This pickup can no longer be inspected.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", "The inspection could not be saved.", 500);
  }
}

/**
 * Saves (or replaces) the three pickup answers. PUT because the row is one per
 * donation and a re-save replaces it. The decision and the volunteer id are
 * derived server-side; neither may come from the body.
 */
export async function PUT(
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

    const body = await parseJsonBody(
      request,
      pickupInspectionSchema,
      "The inspection is invalid.",
    );
    if (!body.ok) return body.response;

    const result = await savePickupInspection(
      { store: prismaPickupInspectionStore },
      { volunteerId: actor.id, donationId: id, input: body.data },
    );
    if (!result.ok) return inspectionErrorResponse(result.error);

    const response: VolunteerPickupInspectionResponse = {
      decision: result.decision,
      inspectedAt: result.inspectedAt,
    };
    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // The id and a safe summary only: never the answers or the reason text.
    console.error("Pickup inspection failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The inspection could not be saved.", 500);
  }
}
