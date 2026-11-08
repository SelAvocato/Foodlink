import { NextResponse } from "next/server";
import { z } from "zod";
import { prismaProofStore } from "@/server/admin/prisma-proof-store";
import { getProofSignedUrl } from "@/server/admin/proof-url";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { createServerStorage } from "@/server/storage";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; documentId: string }> },
) {
  let userId: string | undefined;
  let documentId: string | undefined;
  try {
    const actor = await requireRole(["ADMIN"]);

    const params = await context.params;
    userId = params.id;
    documentId = params.documentId;

    const parsedUserId = z.uuid().safeParse(userId);
    if (!parsedUserId.success) {
      return errorResponse("INVALID_REQUEST", "The user id is invalid.", 400);
    }
    const parsedDocumentId = z.uuid().safeParse(documentId);
    if (!parsedDocumentId.success) {
      return errorResponse("INVALID_REQUEST", "The document id is invalid.", 400);
    }

    const result = await getProofSignedUrl(
      { store: prismaProofStore, storage: createServerStorage() },
      { adminId: actor.id, userId: parsedUserId.data, documentId: parsedDocumentId.data },
    );

    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The document was not found.", 404);
    }

    return NextResponse.json(
      { url: result.url, expiresInSeconds: result.expiresInSeconds },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Ids only: the signed URL and the storage key must never reach the log.
    console.error("Proof URL failed", { userId, documentId, error });
    return errorResponse("INTERNAL_ERROR", "The proof URL could not be created.", 500);
  }
}
