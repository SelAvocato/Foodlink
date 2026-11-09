import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { CancelTransition } from "./cancel-donation";

/**
 * The real transition behind cancelDonation(): CANCELLED as the donor, with the
 * optional reason and the event note (a reason is required only for Admin
 * cancels). Only the three expected refusals become results; MISSING_PAYLOAD
 * would be a bug in this wiring and anything else (for example a database
 * failure) is a 500, so both rethrow.
 */
export function createCancelTransition(): CancelTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        "CANCELLED",
        { id: input.donorId, role: "DONOR" },
        {
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          eventNote: "Donation cancelled by the donor.",
        },
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof DonationTransitionError) {
        if (error.code === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
        if (error.code === "INVALID_TRANSITION") return { ok: false, error: "INVALID_TRANSITION" };
        if (error.code === "FORBIDDEN_ACTOR") return { ok: false, error: "FORBIDDEN_ACTOR" };
      }
      throw error;
    }
  };
}
