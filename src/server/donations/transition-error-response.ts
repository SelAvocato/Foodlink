import { errorResponse } from "@/server/http/errors";
import type { DonationTransitionError } from "@/server/donations/transition-donation";

export function transitionErrorResponse(error: DonationTransitionError) {
  const status =
    error.code === "NOT_FOUND" ? 404 :
    error.code === "FORBIDDEN_ACTOR" ? 403 :
    error.code === "INVALID_TRANSITION" ? 409 :
    error.code === "VOLUNTEER_NOT_ACTIVE" ? 422 :
    400;
  return errorResponse(error.code, error.message, status);
}
