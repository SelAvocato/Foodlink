import { NextResponse } from "next/server";
import { z } from "zod";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import {
  getDistributionEntries,
  type DistributionEntriesError,
} from "@/server/distribution/entries";
import { prismaDistributionReadStore } from "@/server/distribution/prisma-distribution-read-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

const NOT_FOUND_MESSAGE = "The donation was not found.";

function distributionErrorResponse(error: DistributionEntriesError): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE, 404);
    case "INVALID_STATE":
      return errorResponse(
        "INVALID_STATE",
        "Distribution entries are only available after delivery.",
        409,
      );
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    const actor = await requireRole(["VOLUNTEER", "ADMIN"]);

    const { id } = await context.params;
    donationId = id;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("NOT_FOUND", NOT_FOUND_MESSAGE, 404);
    }

    const result = await getDistributionEntries(
      { store: prismaDistributionReadStore },
      { actor, donationId: id },
    );
    if (!result.ok) return distributionErrorResponse(result.error);

    return NextResponse.json(
      { summary: result.summary, entries: result.entries },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) return authErrorResponse(error);
    console.error("Distribution entries read failed", {
      donationId,
      ...safeErrorSummary(error),
    });
    return errorResponse(
      "INTERNAL_ERROR",
      "The distribution entries could not be loaded.",
      500,
    );
  }
}
