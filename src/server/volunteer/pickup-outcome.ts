import { DonationStatus, PickupDecision, ScreeningVerdict } from "@/contracts/enums";
import {
  pickupOutcomeFor,
  type PickupOutcomeStatus,
} from "@/contracts/volunteer-pickup-outcome";
import { screeningBlocksPickupAcceptance } from "@/contracts/volunteer-pickup-inspection";

/** Used only if a REJECTED row somehow has no reason; the schema forbids that. */
export const FALLBACK_REJECTION_REASON = "Rejected at pickup inspection.";

/** The donation facts the outcome needs. */
export type PickupOutcomeDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

/** The saved inspection the transition reads; no other copy exists. */
export type StoredPickupInspection = {
  volunteerId: string;
  decision: PickupDecision;
  reason: string | null;
  screeningId: string | null;
};

export type PickupOutcomeScreening = {
  verdict: ScreeningVerdict;
};

export type RecordPickupOutcomeInput = {
  donationId: string;
  volunteerId: string;
  to: PickupOutcomeStatus;
  reason?: string;
  screeningId?: string;
  decision: PickupDecision;
};

/**
 * The real transition behind recordPickupOutcome(). It must perform the
 * transition, tracking, exit, notification and audit writes in one transaction.
 */
export type PickupOutcomeTransition = (
  input: RecordPickupOutcomeInput,
) => Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" }>;

export interface PickupOutcomeStore {
  readDonation(id: string): Promise<PickupOutcomeDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  findInspection(donationId: string): Promise<StoredPickupInspection | null>;
  findScreening(screeningId: string): Promise<PickupOutcomeScreening | null>;
}

export type PickupOutcomeError =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INSPECTION_REQUIRED"
  | "SCREENING_BLOCKED";

export type RecordPickupOutcomeResult =
  | { ok: true; status: PickupOutcomeStatus; decision: PickupDecision }
  | { ok: false; error: PickupOutcomeError };

/**
 * Applies the saved inspection to the donation: ACCEPTED becomes PICKED_UP,
 * REJECTED becomes REJECTED_AT_PICKUP with the inspection's reason and
 * screening. The transition is a single conditional write (ASSIGNED to the
 * outcome), so a repeated call or a concurrent cancel is refused instead of
 * overwriting a finished donation. A FLAG screening still blocks picking up:
 * C6 already refused to save an ACCEPTED row for it, so this only catches a
 * row that changed under us.
 */
export async function recordPickupOutcome(
  deps: { store: PickupOutcomeStore; transition: PickupOutcomeTransition },
  args: { volunteerId: string; donationId: string },
): Promise<RecordPickupOutcomeResult> {
  const { volunteerId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // Assignment before the status: a volunteer who is not on this donation must
  // not learn its state from the error.
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const inspection = await deps.store.findInspection(donationId);
  if (!inspection || inspection.volunteerId !== volunteerId) {
    return { ok: false, error: "INSPECTION_REQUIRED" };
  }

  const to = pickupOutcomeFor(inspection.decision);
  if (inspection.decision === PickupDecision.ACCEPTED && inspection.screeningId) {
    const screening = await deps.store.findScreening(inspection.screeningId);
    if (screening && screeningBlocksPickupAcceptance(screening.verdict)) {
      return { ok: false, error: "SCREENING_BLOCKED" };
    }
  }

  const result = await deps.transition({
    donationId,
    volunteerId,
    to,
    decision: inspection.decision,
    ...(inspection.decision === PickupDecision.REJECTED
      ? {
          reason: inspection.reason ?? FALLBACK_REJECTION_REASON,
          ...(inspection.screeningId === null ? {} : { screeningId: inspection.screeningId }),
        }
      : {}),
  });
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, status: to, decision: inspection.decision };
}
