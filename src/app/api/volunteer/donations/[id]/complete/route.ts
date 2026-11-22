import { NextResponse } from "next/server";
import { z } from "zod";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import {
  completeDistribution,
  type DistributionCompletionError,
} from "@/server/volunteer/distribution-completion";
import {
  createDistributionCompletionTransition,
  prismaDistributionCompletionStore,
} from "@/server/volunteer/prisma-distribution-completion-store";

export const runtime = "nodejs";

function completionErrorResponse(error: DistributionCompletionError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "RECONCILIATION_INCOMPLETE":
      return errorResponse(
        "RECONCILIATION_INCOMPLETE",
        "Record distribution entries that exactly match the donated portions before closing.",
        409,
      );
    case "INVALID_STATE":
    default:
      return errorResponse("INVALID_STATE", "Only a delivered donation can be closed.", 409);
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const result = await completeDistribution(
      {
        store: prismaDistributionCompletionStore,
        transition: createDistributionCompletionTransition(),
      },
      { volunteerId: actor.id, donationId: id },
    );
    if (!result.ok) return completionErrorResponse(result.error);

    return NextResponse.json(
      {
        status: result.status,
        closedAt: result.closedAt,
        progress: result.progress,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Complete distribution failed", {
      donationId,
      ...safeErrorSummary(error),
    });
    return errorResponse("INTERNAL_ERROR", "The donation could not be closed.", 500);
  }
}
