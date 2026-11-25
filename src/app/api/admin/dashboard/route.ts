import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDashboardQuerySchema } from "@/contracts/admin-dashboard";
import { safeErrorSummary } from "@/lib/safe-error";
import { getAdminDashboard } from "@/server/admin/dashboard";
import { prismaAdminDashboardStore } from "@/server/admin/prisma-dashboard-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireRole(["ADMIN"]);

    const parsed = adminDashboardQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The dashboard query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const dashboard = await getAdminDashboard(
      { store: prismaAdminDashboardStore },
      { now: new Date() },
    );

    return NextResponse.json(dashboard, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Admin dashboard failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The command center could not be loaded.", 500);
  }
}
