import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDonationQueueQuerySchema } from "@/contracts/admin-donation-queue";
import { safeErrorSummary } from "@/lib/safe-error";
import { listAdminDonationQueue } from "@/server/admin/donation-queue";
import { prismaDonationQueueStore } from "@/server/admin/prisma-donation-queue-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Role first: the query string is not read before the Admin is verified.
    await requireRole(["ADMIN"]);

    const parsed = adminDonationQueueQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The queue query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const donations = await listAdminDonationQueue(
      { store: prismaDonationQueueStore },
      { limit: parsed.data.limit, foodCategoryId: parsed.data.foodCategoryId },
    );

    return NextResponse.json(
      { donations },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: the message and stack never reach the log.
    console.error("Admin donation queue failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donation queue could not be loaded.", 500);
  }
}
