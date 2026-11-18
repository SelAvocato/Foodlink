import { DonationStatus, QrScanStage } from "./enums";
import { qrTokenBodySchema, type QrTokenBody } from "./qr-scan";

/** Same body as the pickup scan: the token is never a URL segment. */
export const dropoffScanBodySchema = qrTokenBodySchema;
export type DropoffScanBody = QrTokenBody;

/**
 * The drop-off scan is also the delivery record: one call records the DROPOFF
 * scan and moves the donation to DELIVERED. A repeat after delivery answers 200
 * with alreadyScanned: true and the original time.
 */
export type DropoffScanResponse = {
  stage: typeof QrScanStage.DROPOFF;
  status: typeof DonationStatus.DELIVERED;
  scannedAt: Date;
  alreadyScanned: boolean;
};
