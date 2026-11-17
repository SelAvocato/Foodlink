import { NextResponse } from "next/server";
import { z } from "zod";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { createServerStorage } from "@/server/storage";
import { getDonorPhotoUrl } from "@/server/volunteer/donor-photo-url";
import { prismaPickupPhotoStore } from "@/server/volunteer/prisma-pickup-photo-store";

export const runtime = "nodejs";

/** A short-lived signed URL to the donor's food photo, for the assigned volunteer only. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: the params are not read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const result = await getDonorPhotoUrl(
      { store: prismaPickupPhotoStore, storage: createServerStorage() },
      { volunteerId: actor.id, donationId: id },
    );
    if (!result.ok) {
      if (result.error === "NOT_FOUND") {
        return errorResponse("NOT_FOUND", "The photo was not found.", 404);
      }
      return errorResponse("INVALID_STATE", "This pickup is no longer active.", 409);
    }

    return NextResponse.json(
      { url: result.url, expiresInSeconds: result.expiresInSeconds, mimeType: result.mimeType },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // The id and a safe summary only: never the storage key or the signed URL.
    console.error("Donor photo URL failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The photo could not be loaded.", 500);
  }
}
