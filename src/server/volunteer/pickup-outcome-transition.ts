import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { PickupOutcomeTransition } from "./pickup-outcome";

/**
 * The real transition behind recordPickupOutcome(). The volunteer comes from
 * the session; the reason and screening id come from the saved inspection. A
 * repeated or raced call is refused by the conditional status write.
 */
export function createPickupOutcomeTransition(): PickupOutcomeTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        input.to,
        { id: input.volunteerId, role: "VOLUNTEER" },
        {
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.screeningId === undefined ? {} : { screeningId: input.screeningId }),
          eventNote:
            input.to === "PICKED_UP"
              ? "Donation picked up after inspection."
              : "Donation rejected at pickup after inspection.",
          metadata: { source: "pickup_inspection", decision: input.decision },
        },
      );
      return { ok: true };
    } catch (error) {
      // Only the expected refusals become results: a volunteer removed between
      // the read and the write must not learn why, and a finished donation is a
      // plain state conflict. Anything else is a wiring bug, so rethrow it.
      if (error instanceof DonationTransitionError) {
        if (error.code === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
        if (error.code === "INVALID_TRANSITION" || error.code === "FORBIDDEN_ACTOR") {
          return { ok: false, error: "INVALID_STATE" };
        }
      }
      throw error;
    }
  };
}
