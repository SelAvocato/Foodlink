import { NextResponse } from "next/server";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getDonorProfile } from "@/server/donor/donor-profile";
import { prismaDonorProfileStore } from "@/server/donor/prisma-donor-profile-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** The donor Profile screen (Figma p15): the signed-in donor's own profile, one row. */
export async function GET() {
  try {
    // Role first: nothing else is read before the Donor is verified.
    const actor = await requireRole(["DONOR"]);

    // The user id comes from the session only: there is no id in the URL, no query
    // and no body, so another donor's profile can never be requested here.
    const result = await getDonorProfile(
      { store: prismaDonorProfileStore },
      { userId: actor.id },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The profile was not found.", 404);
    }

    return NextResponse.json(
      { profile: result.profile },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the row, the email or the phone.
    console.error("Donor profile read failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The profile could not be loaded.", 500);
  }
}
