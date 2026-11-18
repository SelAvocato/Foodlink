import { DonationStatus, QrScanStage } from "@/contracts/enums";
import type { DropoffScanResponse } from "@/contracts/volunteer-dropoff";

/** The donation facts a drop-off scan needs. */
export type DropoffScanDonation = {
  id: string;
  status: DonationStatus;
  deletedAt: Date | null;
};

export type DropoffScanRow = {
  scannedAt: Date;
  scannedByUserId: string;
};

export type RecordedDropoffScan = DropoffScanRow & {
  /** False when the (donation_id, stage) row already existed. */
  inserted: boolean;
};

export interface DropoffScanStore {
  findByQrToken(token: string): Promise<DropoffScanDonation | null>;
  /** The volunteer on the current (ended_at IS NULL) assignment, or null. */
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /** This volunteer's existing DROPOFF scan, used to answer a repeat idempotently. */
  findScan(donationId: string, volunteerId: string): Promise<DropoffScanRow | null>;
  /**
   * Inserts the DROPOFF row only while the donation is PICKED_UP and not
   * deleted, and returns the existing row on a conflict. Null when there is no
   * row to insert or return, because the donation changed first.
   */
  recordScan(input: {
    donationId: string;
    scannedByUserId: string;
  }): Promise<RecordedDropoffScan | null>;
}

/** The real transition behind recordDropoffScan(); DELIVERED is the only move it makes. */
export type DropoffTransition = (
  input: { donationId: string; volunteerId: string },
) => Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" }>;

export type DropoffScanResult =
  | { ok: true; response: DropoffScanResponse }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" };

/**
 * Records the DROPOFF scan and marks the donation DELIVERED in one call. The
 * token is matched to the donation in the URL, so a leaked token cannot be used
 * to probe another donation. The scan row is written before the transition: if
 * the transition loses a race the scan is already recorded and a retry finishes
 * the job. A repeat after delivery is a no-op that returns the original time.
 * The token never leaves this function.
 */
export async function recordDropoffScan(
  deps: { store: DropoffScanStore; transition: DropoffTransition },
  args: { volunteerId: string; donationId: string; token: string },
): Promise<DropoffScanResult> {
  const { store, transition } = deps;
  const { volunteerId, donationId, token } = args;

  const donation = await store.findByQrToken(token);
  // An unknown token, a token for another donation and a discarded donation are
  // the same answer: the scan found nothing.
  if (!donation || donation.id !== donationId || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // Assignment is checked before the status so a volunteer who is not on this
  // donation cannot learn its state from the error.
  if ((await store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // A repeat after delivery returns the original scan instead of a second
  // transition (the transition itself would refuse it).
  if (donation.status === DonationStatus.DELIVERED) {
    const existing = await store.findScan(donationId, volunteerId);
    if (!existing) return { ok: false, error: "INVALID_STATE" };
    return {
      ok: true,
      response: {
        stage: QrScanStage.DROPOFF,
        status: DonationStatus.DELIVERED,
        scannedAt: existing.scannedAt,
        alreadyScanned: true,
      },
    };
  }

  // Only a picked-up donation can be delivered. ASSIGNED means the pickup was
  // never recorded; anything else is an exit or a finished donation.
  if (donation.status !== DonationStatus.PICKED_UP) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const scan = await store.recordScan({ donationId, scannedByUserId: volunteerId });
  if (!scan) return { ok: false, error: "INVALID_STATE" };
  // The row is unique per donation and stage. Another volunteer's row means the
  // assignment changed or the data is inconsistent, so it is not this actor's scan.
  if (scan.scannedByUserId !== volunteerId) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const transitioned = await transition({ donationId, volunteerId });
  if (!transitioned.ok) return { ok: false, error: transitioned.error };

  return {
    ok: true,
    response: {
      stage: QrScanStage.DROPOFF,
      status: DonationStatus.DELIVERED,
      scannedAt: scan.scannedAt,
      alreadyScanned: !scan.inserted,
    },
  };
}
