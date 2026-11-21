import { NextResponse } from "next/server";
import { z } from "zod";
import { adminAcceptedDonationsQuerySchema } from "@/contracts/admin-accepted-donations";
import { safeErrorSummary } from "@/lib/safe-error";
import { listAcceptedDonations } from "@/server/admin/accepted-donations";
import { prismaAcceptedDonationsStore } from "@/server/admin/prisma-accepted-donations-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Role first: the query string is not read before the Admin is verified.
    await requireRole(["ADMIN"]);

    const parsed = adminAcceptedDonationsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The list query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    // The clock lives here, never in the service, so the expiry filter is testable.
    const donations = await listAcceptedDonations(
      { store: prismaAcceptedDonationsStore },
      { now: new Date(), limit: parsed.data.limit },
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
    console.error("Accepted donation list failed", { ...safeErrorSummary(error) });
    return errorResponse(
      "INTERNAL_ERROR",
      "The accepted donation list could not be loaded.",
      500,
    );
  }
}
