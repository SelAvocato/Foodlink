import { DonationStatus } from "@/contracts/enums";
import type { VolunteerScanResponse } from "@/contracts/volunteer-scan";
import { recordPickupScan, type PickupScanStore } from "./pickup-scan";

export type TokenScanResult =
  | { ok: true; response: VolunteerScanResponse }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" };

/**
 * Finds the donation behind a QR token and says what the volunteer does next.
 * The label carries no donation id, so the token is the only input besides the
 * session. The PICKUP recording rules live in recordPickupScan() and are reused
 * as-is; a PICKED_UP donation only points the volunteer at the drop-off screen.
 * The token never leaves this function.
 */
export async function resolvePickupScan(
  deps: { store: PickupScanStore; now?: () => Date },
  args: { volunteerId: string; token: string },
): Promise<TokenScanResult> {
  const { store, now } = deps;
  const { volunteerId, token } = args;

  const donation = await store.findByQrToken(token);
  // An unknown token and a discarded donation are the same answer.
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }

  // Assignment is checked before the status so a volunteer who is not on this
  // donation cannot learn its state from the error.
  const currentVolunteerId = await store.findCurrentVolunteerId(donation.id);
  if (currentVolunteerId !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (donation.status === DonationStatus.PICKED_UP) {
    return {
      ok: true,
      response: {
        donationId: donation.id,
        status: DonationStatus.PICKED_UP,
        nextStep: "DROPOFF",
        scannedAt: null,
        alreadyScanned: null,
      },
    };
  }

  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }

  // The pickup rules (window, idempotent repeat scan) stay in one place.
  const scan = await recordPickupScan(
    { store, now },
    { volunteerId, donationId: donation.id, token },
  );
  if (!scan.ok) return { ok: false, error: scan.error };

  return {
    ok: true,
    response: {
      donationId: donation.id,
      status: DonationStatus.ASSIGNED,
      nextStep: "INSPECTION",
      scannedAt: scan.response.scannedAt,
      alreadyScanned: scan.response.alreadyScanned,
    },
  };
}
