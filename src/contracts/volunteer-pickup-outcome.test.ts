import { describe, expect, it } from "vitest";
import { DonationStatus, PickupDecision } from "./enums";
import { pickupOutcomeFor, type PickupOutcomeStatus } from "./volunteer-pickup-outcome";

describe("pickupOutcomeFor", () => {
  it("marks an accepted inspection as picked up", () => {
    expect(pickupOutcomeFor(PickupDecision.ACCEPTED)).toBe(DonationStatus.PICKED_UP);
  });

  it("marks a rejected inspection as rejected at pickup", () => {
    expect(pickupOutcomeFor(PickupDecision.REJECTED)).toBe(DonationStatus.REJECTED_AT_PICKUP);
  });

  it("pins the outcomes as the two post-pickup statuses, never a transit status", () => {
    const statuses: PickupOutcomeStatus[] = [
      pickupOutcomeFor(PickupDecision.ACCEPTED),
      pickupOutcomeFor(PickupDecision.REJECTED),
    ];

    expect(statuses).toEqual(["PICKED_UP", "REJECTED_AT_PICKUP"]);
    expect(statuses).not.toContain(DonationStatus.ASSIGNED);
    expect(statuses).not.toContain(DonationStatus.DELIVERED);
  });
});
