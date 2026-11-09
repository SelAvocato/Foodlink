import { NextResponse } from "next/server";
import { z } from "zod";
import { screeningQueueQuerySchema } from "@/contracts/screening-queue";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { DEFAULT_SIGNED_URL_SECONDS } from "@/lib/storage";
import { listScreeningQueue } from "@/server/screening/review-queue";
import { prismaReviewQueueStore } from "@/server/screening/prisma-review-queue-store";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

/**
 * Admin screening review queue (read side, PDF IV): pending REVIEW cases with
 * the checklist and a short-lived signed photo URL. Admin-wide: there is no
 * ownership check and no donor contact data. The signed URL lives in the
 * response only (no-store) and is never logged.
 */
export async function GET(request: Request) {
  try {
    // Role first: the query string is not read before the actor is verified.
    await requireRole(["ADMIN"]);

    const parsed = screeningQueueQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The screening queue query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const storage = createServerStorage();
    const screenings = await listScreeningQueue(
      {
        store: prismaReviewQueueStore,
        signPhoto: (key) => storage.getSignedUrl(key, DEFAULT_SIGNED_URL_SECONDS),
      },
      { limit: parsed.data.limit },
    );
    return NextResponse.json(
      { screenings },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Safe error tokens only: never the raw message (it can contain a signed
    // URL) and never a storage key.
    console.error("Screening queue failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The screening queue could not be loaded.", 500);
  }
}
