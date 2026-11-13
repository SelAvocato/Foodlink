import { NextResponse } from "next/server";
import { donorDonationDetailId } from "@/contracts/donor-donation-detail";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getDonorDonationDetail } from "@/server/donor/donation-detail";
import { prismaDonationDetailStore } from "@/server/donor/prisma-donation-detail-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** The donor tracking screen (Figma p13): the donor's own donation, one report. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    // Role first: the params are not read before the Donor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    const parsedId = donorDonationDetailId.safeParse(id);
    if (!parsedId.success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    // The donor id comes from the session, never from the URL or a body: another
    // donor's donation is a NOT_FOUND, checked in the same statement as the call.
    const result = await getDonorDonationDetail(
      { store: prismaDonationDetailStore },
      { donationId: parsedId.data, donorId: actor.id },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    }

    // The function's jsonb, minus note and metadata on every timeline entry.
    return NextResponse.json(
      { report: result.report },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the report, names, phones or the error message.
    console.error("Donor donation detail failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donation could not be loaded.", 500);
  }
}
