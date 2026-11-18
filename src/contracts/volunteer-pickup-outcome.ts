import { DonationStatus, PickupDecision } from "./enums";

/**
 * C7 closes the pickup check: an ACCEPTED inspection marks the donation
 * PICKED_UP, a REJECTED inspection marks it REJECTED_AT_PICKUP.
 */
export type PickupOutcomeStatus =
  | typeof DonationStatus.PICKED_UP
  | typeof DonationStatus.REJECTED_AT_PICKUP;

/** The stored decision only; the client never sends the outcome. */
export type VolunteerPickupOutcomeResponse = {
  status: PickupOutcomeStatus;
  decision: PickupDecision;
};

/** The single mapping from the saved inspection to the donation status. */
export function pickupOutcomeFor(decision: PickupDecision): PickupOutcomeStatus {
  return decision === PickupDecision.ACCEPTED
    ? DonationStatus.PICKED_UP
    : DonationStatus.REJECTED_AT_PICKUP;
}
