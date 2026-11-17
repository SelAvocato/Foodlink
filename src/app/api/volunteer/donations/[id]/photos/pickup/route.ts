import { NextResponse } from "next/server";
import { z } from "zod";
import { validateImage } from "@/contracts/image";
import {
  MAX_PICKUP_PHOTO_BYTES,
  PICKUP_PHOTO_MESSAGE,
  type VolunteerPickupPhotoResponse,
} from "@/contracts/volunteer-pickup-photo";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { getScreeningProvider } from "@/server/screening/get-provider";
import { createServerStorage } from "@/server/storage";
import {
  savePickupPhoto,
  type PickupPhotoError,
} from "@/server/volunteer/pickup-photo";
import { prismaPickupPhotoStore } from "@/server/volunteer/prisma-pickup-photo-store";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the storage or database one. */
function uploadErrorResponse(error: PickupPhotoError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "SCAN_REQUIRED":
      return errorResponse(
        "SCAN_REQUIRED",
        "Scan the donation label before adding a photo.",
        409,
      );
    case "INVALID_STATE":
      return errorResponse("INVALID_STATE", "This pickup can no longer be updated.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", "The photo could not be saved.", 500);
  }
}

/** Uploads and screens the volunteer's pickup photo; the scan must already be recorded. */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor the form body are read before the actor is verified.
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send the photo as multipart form data.", 400);
    }

    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      return errorResponse("INVALID_REQUEST", PICKUP_PHOTO_MESSAGE, 400);
    }
    // The declared Content-Type and the file name are never trusted: the bytes decide.
    if (photo.size === 0 || photo.size > MAX_PICKUP_PHOTO_BYTES) {
      return errorResponse("INVALID_REQUEST", PICKUP_PHOTO_MESSAGE, 400);
    }
    const data = new Uint8Array(await photo.arrayBuffer());
    const check = validateImage(data);
    if (!check.ok) {
      return errorResponse("INVALID_REQUEST", PICKUP_PHOTO_MESSAGE, 400);
    }

    // The volunteer id comes from the session, never from the form.
    const result = await savePickupPhoto(
      {
        store: prismaPickupPhotoStore,
        storage: createServerStorage(),
        provider: getScreeningProvider(),
      },
      { volunteerId: actor.id, donationId: id, file: { contentType: check.mime, data } },
    );
    if (!result.ok) return uploadErrorResponse(result.error);

    const body: VolunteerPickupPhotoResponse = {
      verdict: result.verdict,
      screeningId: result.screeningId,
    };
    return NextResponse.json(body, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // The id and a safe summary only: never the storage key, URL or file contents.
    console.error("Pickup photo upload failed", { donationId, ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The photo could not be saved.", 500);
  }
}
