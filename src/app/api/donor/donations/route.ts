import { NextResponse } from "next/server";
import { z } from "zod";
import { donorDonationListQuerySchema } from "@/contracts/donor-donation-list";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getDonorDonationList } from "@/server/donor/donation-list";
import { prismaDonationListStore } from "@/server/donor/prisma-donation-list-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** The donor's "My donations" list (Figma p12): tabs, search, status filter, pages. */
export async function GET(request: Request) {
  try {
    // Role first: the query string is not read before the Donor is verified.
    const actor = await requireRole(["DONOR"]);

    const parsed = donorDonationListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      // The strict schema rejects donorId and anything else the screen does not send.
      return errorResponse(
        "INVALID_REQUEST",
        "The donation list query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    // The donor id comes from the session, never from the query string.
    const result = await getDonorDonationList(
      { store: prismaDonationListStore },
      { donorId: actor.id, query: parsed.data },
    );

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the query, the rows, food names or the message.
    console.error("Donor donation list failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donations could not be loaded.", 500);
  }
}
