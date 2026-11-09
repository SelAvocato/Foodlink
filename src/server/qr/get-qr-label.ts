import { DonationStatus } from "@/contracts/enums";

/** The donation row readQrLabel returns: the token only ever leaves for its owner. */
export type QrLabelRow = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
  qrToken: string | null;
};

export interface QrStore {
  /** Plain read outside any transaction: a label is a snapshot, the scan validates later. */
  readQrLabel(donationId: string): Promise<QrLabelRow | null>;
}

export type GetQrLabelFailure = { ok: false; error: "NOT_FOUND" | "NOT_AVAILABLE" };
export type GetQrLabelResult =
  | { ok: true; donationId: string; status: DonationStatus; qrToken: string }
  | GetQrLabelFailure;

/** The donor may show the label while the donation is up for pickup (PDF: until pickup). */
const visibleStatuses = new Set<DonationStatus>([
  DonationStatus.POSTED,
  DonationStatus.ACCEPTED,
  DonationStatus.ASSIGNED,
]);

/**
 * Returns the QR label token for the donor's own donation while it is POSTED,
 * ACCEPTED or ASSIGNED. The route wraps it in no-store; the token is never logged.
 */
export async function getQrLabel(
  deps: { store: QrStore },
  args: { donorId: string; donationId: string },
): Promise<GetQrLabelResult> {
  const donation = await deps.store.readQrLabel(args.donationId);
  // Another donor's donation, a discarded donation and a vanished id are one NOT_FOUND.
  if (!donation || donation.deletedAt !== null || donation.donorId !== args.donorId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // Past pickup the label stops mattering, and a donation that never got a token
  // (anything before posting) has nothing to show.
  if (!visibleStatuses.has(donation.status) || donation.qrToken === null) {
    return { ok: false, error: "NOT_AVAILABLE" };
  }
  return {
    ok: true,
    donationId: args.donationId,
    status: donation.status,
    qrToken: donation.qrToken,
  };
}
