import { NextResponse } from "next/server";
import { safeErrorSummary } from "@/lib/safe-error";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getFoodOptions } from "@/server/donor/food-options";
import { prismaFoodOptionsStore } from "@/server/donor/prisma-food-options-store";
import { authErrorResponse, errorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

/** Reference data for the donate wizard: food categories, allergens and dietary tags. */
export async function GET() {
  try {
    // Role first: nothing else is read before the Donor is verified.
    const actor = await requireRole(["DONOR"]);

    // The user id comes from the session only: there is no id in the URL, no query
    // and no body, so only the session donor's own reference data is ever built.
    const result = await getFoodOptions(
      { store: prismaFoodOptionsStore },
      { userId: actor.id },
    );
    if (!result.ok) {
      return errorResponse("NOT_FOUND", "The food options were not found.", 404);
    }

    return NextResponse.json(result.options, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // A safe summary only: never the rows or their values.
    console.error("Donor food options read failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The food options could not be loaded.", 500);
  }
}
