import { NextResponse } from "next/server";
import { z } from "zod";
import { volunteerDonationListQuerySchema } from "@/contracts/volunteer-donation-list";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { getVolunteerDonationList } from "@/server/volunteer/donation-list";
import { prismaVolunteerDonationListStore } from "@/server/volunteer/prisma-volunteer-donation-list-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await requireRole(["VOLUNTEER"]);

    const parsed = volunteerDonationListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "The donation list query is invalid.",
        400,
        z.flattenError(parsed.error),
      );
    }

    const result = await getVolunteerDonationList(
      { store: prismaVolunteerDonationListStore },
      { volunteerId: actor.id, query: parsed.data },
    );

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    console.error("Volunteer donation list failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The donations could not be loaded.", 500);
  }
}
