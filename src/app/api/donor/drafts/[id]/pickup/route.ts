import { NextResponse } from "next/server";
import { z } from "zod";
import { savePickupSchema } from "@/contracts/donation-pickup";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { safeErrorSummary } from "@/lib/safe-error";
import { getPickup, savePickup } from "@/server/pickup/donation-pickup";
import { prismaPickupStore } from "@/server/pickup/prisma-pickup-store";

export const runtime = "nodejs";

/** Service refusals only; the message is ours, never the database's. */
function pickupErrorResponse(error: string, fallbackMessage: string): Response {
  switch (error) {
    case "NOT_FOUND":
      return errorResponse("NOT_FOUND", "The draft was not found.", 404);
    case "NOT_EDITABLE":
      return errorResponse("NOT_EDITABLE", "That draft can no longer be edited.", 409);
    case "PICKUP_START_NOT_IN_FUTURE":
      return errorResponse("PICKUP_START_NOT_IN_FUTURE", "The pickup window must start in the future.", 422);
    case "CONSUME_BY_NOT_AFTER_PICKUP_END":
      return errorResponse(
        "CONSUME_BY_NOT_AFTER_PICKUP_END",
        "The pickup window must end before the consume-by time.",
        422,
      );
    default:
      return errorResponse("INTERNAL_ERROR", fallbackMessage, 500);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let donationId: string | undefined;
  try {
    // Role first: neither the params nor the body are read before the actor is verified.
    const actor = await requireRole(["DONOR"]);

    const { id } = await context.params;
    donationId = id;
    // A malformed id says nothing about which drafts exist, so it is a plain 400
    // like every other route; the service answers 404 for a missing or foreign id.
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The draft id is invalid.", 400);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
    }

    const parsed = savePickupSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("INVALID_REQUEST", "The pickup is invalid.", 400, z.flattenError(parsed.error));
    }

    // The donor id comes from the session, never from the body: another donor's
    // draft is a NOT_FOUND for this actor.
    const result = await savePickup(
      { store: prismaPickupStore },
      { donorId: actor.id, donationId: id, input: parsed.data },
    );
    if (!result.ok) return pickupErrorResponse(result.error, "The pickup could not be saved.");

    return NextResponse.json({ donationId: id }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Only the donation id and a log-safe error summary: never the request
    // body, the address or the error message (it can carry a storage key).
    console.error("Pickup save failed", { donationId, error: safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The pickup could not be saved.", 500);
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

    const result = await getPickup({ store: prismaPickupStore }, { donorId: actor.id, donationId: id });
    if (!result.ok) return pickupErrorResponse(result.error, "The pickup could not be loaded.");

    return NextResponse.json({ pickup: result.pickup }, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    // Only the donation id and a log-safe error summary: never the address.
    console.error("Pickup read failed", { donationId, error: safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The pickup could not be loaded.", 500);
  }
}
