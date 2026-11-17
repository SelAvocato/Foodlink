import { DonationStatus, QrScanStage } from "@/contracts/enums";
import type { PickupScanResponse } from "@/contracts/volunteer-pickup-scan";

/** The donation facts a scan needs. */
export type PickupScanDonation = {
  id: string;
  status: DonationStatus;
  pickupEnd: Date | null;
  deletedAt: Date | null;
};

export type RecordedScan = {
  /** False when the (donation_id, stage) row already existed: the scan is a no-op. */
  inserted: boolean;
  scannedAt: Date;
  scannedByUserId: string;
};

export interface PickupScanStore {
  findByQrToken(token: string): Promise<PickupScanDonation | null>;
  /** The volunteer on the current (ended_at IS NULL) assignment, or null. */
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /**
   * Inserts the stage row only while the donation is ASSIGNED and not deleted,
   * and returns the existing row on a conflict. Null when there is no row to
   * insert or return, because the donation changed first.
   */
  recordScan(input: {
    donationId: string;
    stage: QrScanStage;
    scannedByUserId: string;
  }): Promise<RecordedScan | null>;
}

export type PickupScanResult =
  | { ok: true; response: PickupScanResponse }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" };

/**
 * Records the PICKUP scan for a donation the actor is currently assigned to.
 * The token is matched to the donation in the URL, so a leaked token cannot be
 * used to probe another donation. A repeat scan is a no-op that returns the
 * original time. The token never leaves this function.
 */
export async function recordPickupScan(
  deps: { store: PickupScanStore; now?: () => Date },
  args: { volunteerId: string; donationId: string; token: string },
): Promise<PickupScanResult> {
  const { store, now = () => new Date() } = deps;
  const { volunteerId, donationId, token } = args;

  const donation = await store.findByQrToken(token);
  // An unknown token, a token for another donation and a discarded donation are
  // the same answer: the scan found nothing.
  if (!donation || donation.id !== donationId || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // Assignment is checked before the status and the clock so a volunteer who is
  // not on this donation cannot learn its state from the error.
  const currentVolunteerId = await store.findCurrentVolunteerId(donationId);
  if (currentVolunteerId !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }
  // The label is useless after the window; the expiry job may not have run yet.
  if (donation.pickupEnd === null || donation.pickupEnd <= now()) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const scan = await store.recordScan({
    donationId,
    stage: QrScanStage.PICKUP,
    scannedByUserId: volunteerId,
  });
  if (!scan) return { ok: false, error: "INVALID_STATE" };
  // The row is unique per donation and stage. Another volunteer's row means the
  // assignment changed or the data is inconsistent, so it is not this actor's scan.
  if (scan.scannedByUserId !== volunteerId) {
    return { ok: false, error: "INVALID_STATE" };
  }

  return {
    ok: true,
    response: {
      stage: QrScanStage.PICKUP,
      scannedAt: scan.scannedAt,
      alreadyScanned: !scan.inserted,
    },
  };
}
