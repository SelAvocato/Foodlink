import { NextResponse } from "next/server";
import { z } from "zod";
import { adminPeopleListQuerySchema } from "@/contracts/admin-people";
import { safeErrorSummary } from "@/lib/safe-error";
import { listAdminPeople } from "@/server/admin/people";
import { prismaAdminPeopleStore } from "@/server/admin/prisma-people-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireRole(["ADMIN"]);

    const parsed = adminPeopleListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The people list query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const result = await listAdminPeople({ store: prismaAdminPeopleStore }, parsed.data);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Admin people list failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "People could not be loaded.", 500);
  }
}
