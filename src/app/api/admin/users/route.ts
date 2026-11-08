import { NextResponse } from "next/server";
import { z } from "zod";
import { listPendingUsers } from "@/server/admin/pending-users";
import { prismaPendingUsersStore } from "@/server/admin/prisma-pending-users-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

const listQuerySchema = z.strictObject({
  status: z.literal("PENDING").default("PENDING"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    await requireRole(["ADMIN"]);

    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The list query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const users = await listPendingUsers(
      { store: prismaPendingUsersStore },
      { limit: parsed.data.limit },
    );
    return NextResponse.json({ users }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Pending user list failed", { error });
    return errorResponse("INTERNAL_ERROR", "The pending user list could not be loaded.", 500);
  }
}
