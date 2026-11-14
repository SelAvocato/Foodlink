import { NextResponse } from "next/server";
import { safeErrorSummary } from "@/lib/safe-error";
import { donorProfileUpdateSchema } from "@/contracts/donor-profile-update";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getDonorProfile } from "@/server/donor/donor-profile";
import { updateDonorProfile } from "@/server/donor/donor-profile-update";
import { prismaDonorProfileStore } from "@/server/donor/prisma-donor-profile-store";
import { prismaDonorProfileUpdateStore } from "@/server/donor/prisma-donor-profile-update-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";

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

/** Saves the contact number and the pickup address with its map pin (Figma p15). */
export async function PUT(request: Request) {
  try {
    // Role first: nothing else is read before the Donor is verified.
    const actor = await requireRole(["DONOR"]);

    // Invalid JSON fails here; an unknown or wrong-typed field is a 400 with the
    // prettified details. Name, business name, email, status and ids are never accepted.
    const parsed = await parseJsonBody(
      request,
      donorProfileUpdateSchema,
      "The profile update is invalid.",
    );
    if (!parsed.ok) {
      return parsed.response;
    }

    // The user id comes from the session only: there is no id in the URL, so no
    // other donor's profile can be saved here.
    const result = await updateDonorProfile(
      { store: prismaDonorProfileUpdateStore },
      {
        userId: actor.id,
        contactNumber: parsed.data.contactNumber,
        address: parsed.data.address,
      },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The profile was not found.", 404);
    }

    // Re-read after the commit, so the response always shows what is stored now.
    const profile = await getDonorProfile(
      { store: prismaDonorProfileStore },
      { userId: actor.id },
    );
    if (!profile.ok) {
      // The save committed, so the row cannot be gone: a bug, not a client error.
      throw new Error("The profile disappeared after a successful save.");
    }

    return NextResponse.json(
      { profile: profile.profile },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the body, the number, the address or the email.
    console.error("Donor profile update failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The profile could not be saved.", 500);
  }
}
