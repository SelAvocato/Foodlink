import { QrScanStage } from "./enums";
import { QR_TOKEN_PATTERN, qrTokenBodySchema, type QrTokenBody } from "./qr-scan";

export { QR_TOKEN_PATTERN };

/** The pickup scan shares the token body with the drop-off scan. */
export const pickupScanBodySchema = qrTokenBodySchema;
export type PickupScanBody = QrTokenBody;

export type PickupScanResponse = {
  stage: typeof QrScanStage.PICKUP;
  scannedAt: Date;
  /** True when this volunteer's earlier scan is already recorded: the call is a no-op. */
  alreadyScanned: boolean;
};
