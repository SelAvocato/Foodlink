import "server-only";

import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { PostTransition } from "./post-donation";

/**
 * The real transition behind postDonation(): SCREENED to POSTED as the donor,
 * with the server-generated QR token and the event note. Only the three
 * expected refusals become results; MISSING_PAYLOAD would be a bug in this
 * wiring (the token always travels) and a unique violation on the token is a
 * 500, so both rethrow.
 */
export function createPostTransition(): PostTransition {
  return async (input) => {
    try {
      await transitionDonation(
        { store: prismaTransitionStore },
        input.donationId,
        "POSTED",
        { id: input.donorId, role: "DONOR" },
        { qrToken: input.qrToken, eventNote: "Donation posted." },
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
