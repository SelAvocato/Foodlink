import { NextResponse } from "next/server";
import { z } from "zod";
import { screeningDecisionSchema } from "@/contracts/screening-decision";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import { decideScreening } from "@/server/screening/decide-screening";
import { createAdminScreeningTransition } from "@/server/screening/admin-screening-transition";
import { prismaScreeningDecisionStore } from "@/server/screening/prisma-screening-decision-store";

export const runtime = "nodejs";

/**
 * Admin screening decision (write side): PASS moves the DRAFT donation to
 * SCREENED, REJECT to REJECTED with the reason. Admin-wide: there is no
 * ownership check, like the queue route. Only the latest unreviewed REVIEW
 * screening of a DRAFT donation can be decided; the reason, the body and the
 * storage never reach the log.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let screeningId: string | undefined;
  try {
    // Role first: neither the params nor the body are read before the actor is verified.
    const actor = await requireRole(["ADMIN"]);

    const { id } = await context.params;
    screeningId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The screening id is invalid.", 400);
    }

    const parsed = await parseJsonBody(
      request,
      screeningDecisionSchema,
      "The screening decision is invalid.",
    );
    if (!parsed.ok) return parsed.response;

    const result = await decideScreening(
      { store: prismaScreeningDecisionStore, transition: createAdminScreeningTransition() },
      { screeningId: id, actorId: actor.id, ...parsed.data },
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The screening was not found.", 404);
      }
      return errorResponse("NOT_PENDING", "That screening is not awaiting a decision.", 409);
    }

    return NextResponse.json(
      { donationId: result.donationId, screeningId: result.screeningId, from: result.from, to: result.to },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Safe error tokens only: never the reason, the request body or a raw message.
    console.error("Screening decision failed", { screeningId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The screening decision could not be saved.", 500);
  }
}
