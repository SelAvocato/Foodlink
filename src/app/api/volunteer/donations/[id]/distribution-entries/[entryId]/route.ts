import { NextResponse } from "next/server";
import { z } from "zod";
import { updateDistributionEntrySchema } from "@/contracts/volunteer-distribution";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import {
  deleteDistributionEntry,
  updateDistributionEntry,
  type DistributionEntryError,
} from "@/server/volunteer/distribution-entries";
import { prismaDistributionEntryStore } from "@/server/volunteer/prisma-distribution-entry-store";

export const runtime = "nodejs";

function entryErrorResponse(error: DistributionEntryError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The distribution entry was not found.", 404);
    case "INVALID_STATE":
      return errorResponse(
        "INVALID_STATE",
        "Distribution entries can only be changed after delivery.",
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

type Context = { params: Promise<{ id: string; entryId: string }> };

async function readIds(context: Context) {
  const { id, entryId } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return { ok: false as const, response: errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400) };
  }
  if (!z.uuid().safeParse(entryId).success) {
    return { ok: false as const, response: errorResponse("INVALID_REQUEST", "The distribution entry id is invalid.", 400) };
  }
  return { ok: true as const, donationId: id, entryId };
}

export async function PATCH(request: Request, context: Context) {
  let donationId: string | undefined;
  let entryId: string | undefined;
  try {
    const actor = await requireRole(["VOLUNTEER"]);

    const ids = await readIds(context);
    if (!ids.ok) return ids.response;
    donationId = ids.donationId;
    entryId = ids.entryId;

    const body = await parseJsonBody(
      request,
      updateDistributionEntrySchema,
      "The distribution entry is invalid.",
    );
    if (!body.ok) return body.response;

    const result = await updateDistributionEntry(
      { store: prismaDistributionEntryStore },
      { volunteerId: actor.id, donationId, entryId, input: body.data },
    );
    if (!result.ok) return entryErrorResponse(result.error);

    return NextResponse.json(
      { entry: result.entry, progress: result.progress },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Update distribution entry failed", {
      donationId,
      entryId,
      ...safeErrorSummary(error),
    });
    return errorResponse("INTERNAL_ERROR", "The distribution entry could not be saved.", 500);
  }
}

export async function DELETE(_request: Request, context: Context) {
  let donationId: string | undefined;
  let entryId: string | undefined;
  try {
    const actor = await requireRole(["VOLUNTEER"]);

    const ids = await readIds(context);
    if (!ids.ok) return ids.response;
    donationId = ids.donationId;
    entryId = ids.entryId;

    const result = await deleteDistributionEntry(
      { store: prismaDistributionEntryStore },
      { volunteerId: actor.id, donationId, entryId },
    );
    if (!result.ok) return entryErrorResponse(result.error);

    return NextResponse.json(
      { entry: result.entry, progress: result.progress },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Delete distribution entry failed", {
      donationId,
      entryId,
      ...safeErrorSummary(error),
    });
    return errorResponse("INTERNAL_ERROR", "The distribution entry could not be deleted.", 500);
  }
}
