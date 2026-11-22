import { NextResponse } from "next/server";
import { z } from "zod";
import { createDistributionEntrySchema } from "@/contracts/volunteer-distribution";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import {
  createDistributionEntry,
  type DistributionEntryError,
} from "@/server/volunteer/distribution-entries";
import { prismaDistributionEntryStore } from "@/server/volunteer/prisma-distribution-entry-store";

export const runtime = "nodejs";

function entryErrorResponse(error: DistributionEntryError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The donation was not found.", 404);
    case "INVALID_STATE":
      return errorResponse(
        "INVALID_STATE",
        "Distribution entries can only be recorded after delivery.",
        409,
      );
    case "PORTIONS_EXCEEDED":
      return errorResponse(
        "PORTIONS_EXCEEDED",
        "The recorded portions would exceed the donation's portions.",
        409,
      );
    case "INVALID_ENTRY":
    default:
      return errorResponse("INVALID_ENTRY", "The distribution entry is invalid.", 400);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    const actor = await requireRole(["VOLUNTEER"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const body = await parseJsonBody(
      request,
      createDistributionEntrySchema,
      "The distribution entry is invalid.",
    );
    if (!body.ok) return body.response;

    const result = await createDistributionEntry(
      { store: prismaDistributionEntryStore },
      { volunteerId: actor.id, donationId: id, input: body.data },
    );
    if (!result.ok) return entryErrorResponse(result.error);

    return NextResponse.json(
      { entry: result.entry, progress: result.progress },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Create distribution entry failed", {
      donationId,
      ...safeErrorSummary(error),
    });
    return errorResponse("INTERNAL_ERROR", "The distribution entry could not be saved.", 500);
  }
}
