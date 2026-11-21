export { pickupScanBodySchema } from "./volunteer-pickup-scan";
export type { PickupScanBody } from "./volunteer-pickup-scan";

/**
 * What a QR scan answers once the token has been resolved to a donation. The
 * volunteer never sees the raw donation id in the label; the route finds it by
 * the token and tells the app which screen to open next.
 */
export type VolunteerScanResponse = {
  donationId: string;
  status: "ASSIGNED" | "PICKED_UP";
  nextStep: "INSPECTION" | "DROPOFF";
  /** Null for a PICKED_UP donation: no new scan is recorded on that path. */
  scannedAt: Date | null;
  /** Null for a PICKED_UP donation, because no scan row is read or written. */
  alreadyScanned: boolean | null;
};
