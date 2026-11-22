import { NextResponse } from "next/server";
import { z } from "zod";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { readVolunteerChecklist } from "@/server/volunteer/checklist-read";
import { prismaChecklistReadStore } from "@/server/volunteer/prisma-checklist-read-store";

export const runtime = "nodejs";

/** One generic message for every refusal, so the donation state is not revealed. */
const NOT_FOUND_MESSAGE = "The checklist was not found.";

/** The donor's safety checklist, for the volunteer currently assigned to the donation. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // Role first: the params are not read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE, 404);
    }

    const result = await readVolunteerChecklist(
      { store: prismaChecklistReadStore },
      { volunteerId: actor.id, donationId: id },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE, 404);
    }

    return NextResponse.json(result.checklist, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the message, the stack or any donation data.
    console.error("Volunteer checklist read failed", safeErrorSummary(error));
    return errorResponse("INTERNAL_ERROR", "The checklist could not be loaded.", 500);
  }
}
