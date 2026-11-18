import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { DropoffTransition } from "./dropoff-scan";

/**
 * The real transition behind recordDropoffScan(): PICKED_UP to DELIVERED as the
 * assigned Volunteer. The conditional status write makes a concurrent second
 * scan harmless.
 */
export function createDropoffTransition(): DropoffTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        "DELIVERED",
        { id: input.volunteerId, role: "VOLUNTEER" },
        {
          eventNote: "Donation delivered at the drop-off point.",
          metadata: { source: "dropoff_scan" },
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
