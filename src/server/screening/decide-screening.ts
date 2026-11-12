import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import type { ScreeningDecisionBody } from "@/contracts/screening-decision";

/**
 * One food_screenings row with the donation's rule fields, as stored. The
 * latest-screening rule travels as a flag the store computed with the queue's
 * own rule (newest created_at, id as tiebreak), so the service can re-check it.
 */
export type ScreeningDecisionRow = {
  screeningId: string;
  donationId: string;
  verdict: ScreeningVerdict;
  reviewedAt: Date | null;
  donationStatus: DonationStatus;
  deletedAt: Date | null;
  isLatestScreening: boolean;
};

export interface ScreeningDecisionStore {
  /** Plain read outside any transaction; null when the screening does not exist. */
  findScreening(screeningId: string): Promise<ScreeningDecisionRow | null>;
  /**
   * Sets reviewed_by_user_id and reviewed_at while reviewed_at IS NULL and
   * resolves true only when exactly one row was updated. Never writes notes
   * (that column holds the AI notes).
   */
  stampReview(input: { screeningId: string; reviewerId: string; reviewedAt: Date }): Promise<boolean>;
}

export type ScreeningDecisionTransitionInput = {
  donationId: string;
  to: "SCREENED" | "REJECTED";
  screeningId: string;
  actorId: string;
  reason?: string;
};

export type ScreeningDecisionTransitionResult =
  | { ok: true }
  | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" };

/** Injected so the service needs no server-only imports; the wiring file maps the transition errors. */
export type ScreeningDecisionTransition = (
  input: ScreeningDecisionTransitionInput,
) => Promise<ScreeningDecisionTransitionResult>;

export type DecideScreeningDeps = {
  store: ScreeningDecisionStore;
  transition: ScreeningDecisionTransition;
};

export type DecideScreeningInput = {
  screeningId: string;
  actorId: string;
  decision: ScreeningDecisionBody["decision"];
  reason?: string;
};

export type DecideScreeningResult =
  | { ok: true; donationId: string; screeningId: string; from: "DRAFT"; to: "SCREENED" | "REJECTED" }
  | { ok: false; error: "NOT_FOUND" | "NOT_PENDING" };

/**
 * Decides the Admin's screening review. The pending rules are re-checked on
 * what the store returned, then the injected transition moves the donation
 * (transitionDonation() opens its own transaction), and only after it succeeds
 * is the screening stamped reviewed — stamping first could take the case out
 * of the queue while the donation stays DRAFT. A stamp failure never undoes
 * the transition: it propagates and the route answers 500. A stamp that
 * updated no row (the store resolves false) is treated the same way: the
 * service throws and the route answers 500.
 */
export async function decideScreening(
  deps: DecideScreeningDeps,
  input: DecideScreeningInput,
): Promise<DecideScreeningResult> {
  const row = await deps.store.findScreening(input.screeningId);
  if (!row) return { ok: false, error: "NOT_FOUND" };

  const pending =
    row.verdict === ScreeningVerdict.REVIEW &&
    row.reviewedAt === null &&
    row.isLatestScreening &&
    row.donationStatus === DonationStatus.DRAFT &&
    row.deletedAt === null;
  if (!pending) return { ok: false, error: "NOT_PENDING" };

  const to = input.decision === "PASS" ? "SCREENED" : "REJECTED";
  const outcome = await deps.transition({
    donationId: row.donationId,
    to,
    screeningId: row.screeningId,
    actorId: input.actorId,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  });
  if (!outcome.ok) {
    // INVALID_TRANSITION here is a lost race: someone else moved the donation.
    return { ok: false, error: outcome.error === "NOT_FOUND" ? "NOT_FOUND" : "NOT_PENDING" };
  }

  const stamped = await deps.store.stampReview({
    screeningId: row.screeningId,
    reviewerId: input.actorId,
    reviewedAt: new Date(),
  });
  // Invariant: the row was pending a moment ago, so zero rows updated means the
  // stamp did not land. Same handling as a stamp failure: propagate, answer 500.
  if (!stamped) throw new Error("SCREENING_STAMP_NOT_APPLIED");

  return { ok: true, donationId: row.donationId, screeningId: row.screeningId, from: "DRAFT", to };
}
