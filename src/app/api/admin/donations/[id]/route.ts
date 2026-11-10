import { NextResponse } from "next/server";
import { adminDonationDetailId } from "@/contracts/admin-donation-detail";
import { safeErrorSummary } from "@/lib/safe-error";
import { getAdminDonationDetail } from "@/server/admin/donation-detail";
import { prismaDonationDetailStore } from "@/server/admin/prisma-donation-detail-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Role first: the params are not read before the Admin is verified.
    await requireRole(["ADMIN"]);

    const { id } = await context.params;
    const parsedId = adminDonationDetailId.safeParse(id);
    if (!parsedId.success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const result = await getAdminDonationDetail(
      { store: prismaDonationDetailStore },
      { donationId: parsedId.data },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    }

    // The function's jsonb is passed through unchanged: snake_case keys as it builds them.
    return NextResponse.json(
      { report: result.report },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the report, names, phones or the error message.
    console.error("Admin donation detail failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donation could not be loaded.", 500);
  }
}
