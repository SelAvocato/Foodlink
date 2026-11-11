import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewSchema, reviewTargetId } from "@/contracts/review";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { prismaReviewStore } from "@/server/review/prisma-review-store";
import { reviewAccount } from "@/server/review/review-account";
import { safeErrorSummary } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let targetId: string | undefined;
  try {
    const actor = await requireRole(["ADMIN"]);

    const { id } = await context.params;
    targetId = id;
    const parsedId = reviewTargetId.safeParse(id);
    if (!parsedId.success) {
      return errorResponse("INVALID_REQUEST", "The user id is invalid.", 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
    }

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The review request is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const result = await reviewAccount(
      { store: prismaReviewStore },
      { reviewerId: actor.id, targetId: parsedId.data, review: parsed.data },
    );

    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The account was not found.", 404);
      }
      if (result.error === "TARGET_NOT_REVIEWABLE") {
        return errorResponse("TARGET_NOT_REVIEWABLE", "That account cannot be reviewed.", 403);
      }
      return errorResponse(
        "INVALID_TRANSITION",
        "That action does not apply to the account's current status.",
        409,
      );
    }

    return NextResponse.json({ resultingStatus: result.resultingStatus }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Account review failed", { targetId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The account review could not be completed.", 500);
  }
}
