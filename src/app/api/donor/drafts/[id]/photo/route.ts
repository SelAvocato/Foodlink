import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_IMAGE_BYTES, validateImage } from "@/contracts/image";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { getFoodPhotoUrl, saveFoodPhoto } from "@/server/photos/donation-photo";
import { prismaPhotoStore } from "@/server/photos/prisma-photo-store";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

// Vercel rejects request bodies over 4.5 MB before this code runs, so photos are limited to 4 MB
// like the signup proof upload.
const MAX_PHOTO_BYTES = Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024);
const PHOTO_MESSAGE = "Photo must be a JPEG, PNG, or WebP image up to 4 MB.";

/** Upload refusals only; the message is ours, never the storage or database one. */
function uploadErrorResponse(error: "NOT_FOUND" | "NOT_EDITABLE", fallbackMessage: string): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That draft can no longer be edited.", 409);
    default:
      return errorResponse("INTERNAL_ERROR", fallbackMessage, 500);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor the form body are read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send the photo as multipart form data.", 400);
    }

    const photo = form.get("photo");
    if (!(photo instanceof File)) {
      return errorResponse("INVALID_REQUEST", PHOTO_MESSAGE, 400);
    }
    // The declared Content-Type and the file name are never trusted: the bytes decide.
    if (photo.size === 0 || photo.size > MAX_PHOTO_BYTES) {
      return errorResponse("INVALID_REQUEST", PHOTO_MESSAGE, 400);
    }
    const data = new Uint8Array(await photo.arrayBuffer());
    const check = validateImage(data);
    if (!check.ok) {
      return errorResponse("INVALID_REQUEST", PHOTO_MESSAGE, 400);
    }

    // The donor id comes from the session, never from the form: another donor's
    // draft is a NOT_FOUND for this actor.
    const result = await saveFoodPhoto(
      { store: prismaPhotoStore, storage: createServerStorage() },
      { donorId: actor.id, donationId: id, file: { contentType: check.mime, data } },
    );
    if (!result.ok) return uploadErrorResponse(result.error, "The photo could not be saved.");

    return NextResponse.json({ donationId: id, imageId: result.imageId }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Ids only: the storage key and the file contents must never reach the log.
    console.error("Photo upload failed", { donationId, error });
    return errorResponse("INTERNAL_ERROR", "The photo could not be saved.", 500);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: the params are not read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    const result = await getFoodPhotoUrl(
      { store: prismaPhotoStore, storage: createServerStorage() },
      { donorId: actor.id, donationId: id },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The photo was not found.", 404);
    }

    return NextResponse.json(
      { url: result.url, expiresInSeconds: result.expiresInSeconds, mimeType: result.mimeType },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Ids only: the signed URL and the storage key must never reach the log.
    console.error("Photo URL failed", { donationId, error });
    return errorResponse("INTERNAL_ERROR", "The photo could not be loaded.", 500);
  }
}
