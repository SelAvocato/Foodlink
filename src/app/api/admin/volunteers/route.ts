import { NextResponse } from "next/server";
import { z } from "zod";
import { adminActiveVolunteersQuerySchema } from "@/contracts/admin-active-volunteers";
import { safeErrorSummary } from "@/lib/safe-error";
import { listActiveVolunteers } from "@/server/admin/active-volunteers";
import { prismaActiveVolunteersStore } from "@/server/admin/prisma-active-volunteers-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    // Role first: the query string is not read before the Admin is verified.
    await requireRole(["ADMIN"]);

    const parsed = adminActiveVolunteersQuerySchema.safeParse(
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

    const volunteers = await listActiveVolunteers(
      { store: prismaActiveVolunteersStore },
      { limit: parsed.data.limit },
    );
    return NextResponse.json({ volunteers }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: the message and stack never reach the log.
    console.error("Active volunteer list failed", { ...safeErrorSummary(error) });
    return errorResponse(
      "INTERNAL_ERROR",
      "The active volunteer list could not be loaded.",
      500,
    );
  }
}
