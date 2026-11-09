import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { ScreeningTransition } from "./screen-draft-photo";

/**
 * The real transition behind screenDraftPhoto(): DRAFT to SCREENED/REJECTED is
 * a system screening transition, so the actor is null and the screening id,
 * reason, event note and source travel in the payload.
 */
export function createScreeningTransition(): ScreeningTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        input.to,
        null,
        {
          screeningId: input.screeningId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          eventNote:
            input.to === "SCREENED"
              ? "Photo passed automatic screening."
              : "Photo failed visual screening.",
          metadata: { source: "food_screening" },
        },
      );
      return { ok: true };
    } catch (error) {
      // Only the two expected refusals become results; FORBIDDEN_ACTOR or
      // MISSING_PAYLOAD here would be a bug in this wiring, so rethrow them.
      if (error instanceof DonationTransitionError) {
        if (error.code === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
        if (error.code === "INVALID_TRANSITION") return { ok: false, error: "INVALID_TRANSITION" };
      }
      throw error;
    }
  };
}
