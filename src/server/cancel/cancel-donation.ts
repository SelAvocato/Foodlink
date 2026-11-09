import { DonationStatus } from "@/contracts/enums";

/** The donation row readDonation returns: only ownership and status matter here. */
export type CancelDonationRow = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
};

export interface CancelStore {
  /** Plain read outside any transaction: the transition re-checks the status anyway. */
  readDonation(donationId: string): Promise<CancelDonationRow | null>;
}

/** The real transition behind cancelDonation(), wired in cancel-transition.ts. */
export type CancelTransition = (
  input: { donationId: string; donorId: string; reason?: string },
) => Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" }>;

export type CancelDonationFailure = { ok: false; error: "NOT_FOUND" | "NOT_CANCELLABLE" };
export type CancelDonationResult =
  | { ok: true; donationId: string; status: "CANCELLED" }
  | CancelDonationFailure;

/**
 * Cancels the donor's own POSTED or ACCEPTED donation: the read decides whether
 * the donor may ask at all, and the injected transition (donor actor) decides
 * the final answer. donations.status is never written here.
 */
export async function cancelDonation(
  deps: { store: CancelStore; transition: CancelTransition },
  args: { donorId: string; donationId: string; reason?: string },
): Promise<CancelDonationResult> {
  const { store, transition } = deps;
  const { donorId, donationId } = args;

  const donation = await store.readDonation(donationId);
  // Another donor's donation, a discarded draft and a vanished id are one NOT_FOUND.
  if (!donation || donation.deletedAt !== null || donation.donorId !== donorId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // The transition table lets the donor out of POSTED and ACCEPTED only; once a
  // volunteer is assigned (ASSIGNED) only an Admin can cancel.
  if (donation.status !== DonationStatus.POSTED && donation.status !== DonationStatus.ACCEPTED) {
    return { ok: false, error: "NOT_CANCELLABLE" };
  }

  // The contract already trims; trimming here keeps a direct caller (or an
  // empty-after-trim reason) sending the same shape, and an empty reason is omitted.
  const reason = args.reason?.trim();
  const outcome = await transition({
    donationId,
    donorId,
    ...(reason ? { reason } : {}),
  });
  if (!outcome.ok) {
    // A concurrent change raced the read: the donor sees "no longer cancellable"
    // (or NOT_FOUND for an id that vanished), never the transition's message.
    if (outcome.error === "NOT_FOUND") return { ok: false, error: "NOT_FOUND" };
    return { ok: false, error: "NOT_CANCELLABLE" };
  }
  return { ok: true, donationId, status: "CANCELLED" };
}
