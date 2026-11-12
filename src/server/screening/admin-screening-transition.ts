import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { ScreeningDecisionTransition } from "./decide-screening";

/**
 * The real transition behind decideScreening(): DRAFT to SCREENED/REJECTED
 * with the Admin actor, so the reason (REJECT only), the event note, the
 * screening id and the decision source travel in the payload. The reason ends
 * up in donation_exits.reason through transitionDonation().
 */
export function createAdminScreeningTransition(): ScreeningDecisionTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        input.to,
        { id: input.actorId, role: "ADMIN" },
        {
          screeningId: input.screeningId,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          eventNote:
            input.to === "SCREENED"
              ? "Photo passed admin review."
              : "Photo rejected in admin review.",
          metadata: {
            source: "admin_screening_review",
            decision: input.to === "SCREENED" ? "PASS" : "REJECT",
          },
        },
      );
      return { ok: true };
    } catch (error) {
      // Only the two expected refusals become results; FORBIDDEN_ACTOR,
      // MISSING_PAYLOAD or VOLUNTEER_NOT_ACTIVE here would be a bug in this
      // wiring, so rethrow them.
      if (error instanceof DonationTransitionError) {
        if (error.code === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
        if (error.code === "INVALID_TRANSITION") return { ok: false, error: "INVALID_TRANSITION" };
      }
      throw error;
    }
  };
}
