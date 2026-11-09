import { DonationStatus } from "@/contracts/enums";
import { newQrToken } from "@/lib/qr-token";
import { evaluateChecklist, type ChecklistAnswers, type ChecklistFlags } from "@/server/checklist/donation-checklist";

/** The stored checklist row the posting checks re-evaluate. */
export type PostingChecklist = ChecklistAnswers & { completedAt: Date | null };

/** The donation row readForPosting returns: enough to authorise and re-check everything. */
export type PostingDonation = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
  pickupAddressId: string | null;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
  checklist: PostingChecklist | null;
  hasActiveFoodPhoto: boolean;
};

export interface PostingStore {
  /** Plain reads outside any transaction: the checks and the transition are not atomic. */
  readForPosting(donationId: string): Promise<PostingDonation | null>;
}

/** The real transition behind postDonation(), wired in post-transition.ts. */
export type PostTransition = (
  input: { donationId: string; donorId: string; qrToken: string },
) => Promise<{ ok: true } | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" }>;

export type PostDonationError =
  | "NOT_FOUND"
  | "NOT_SCREENED"
  | "NOT_EDITABLE"
  | "PHOTO_REQUIRED"
  | "PICKUP_REQUIRED"
  | "PICKUP_START_NOT_IN_FUTURE"
  | "CONSUME_BY_NOT_AFTER_PICKUP_END";

export type PostDonationFailure =
  | { ok: false; error: PostDonationError }
  | { ok: false; error: "CHECKLIST_INCOMPLETE"; missing: string[] };

export type PostDonationResult =
  | { ok: true; donationId: string; expiresAt: string }
  | PostDonationFailure;

/**
 * Posts the donor's own SCREENED donation: re-validates everything the PDF
 * requires (photo, checklist under the category rules, pickup window), then
 * asks the injected transition to move it to POSTED with a server-generated QR
 * token. The token and donations.status are never written here, only the
 * transition writes them, and the token never appears in the result.
 */
export async function postDonation(
  deps: { store: PostingStore; transition: PostTransition; now?: () => Date; generateToken?: () => string },
  args: { donorId: string; donationId: string },
): Promise<PostDonationResult> {
  const { store, transition, now = () => new Date(), generateToken = newQrToken } = deps;
  const { donorId, donationId } = args;

  const donation = await store.readForPosting(donationId);
  // Another donor's draft, a discarded draft and a vanished id are one NOT_FOUND.
  if (!donation || donation.deletedAt !== null || donation.donorId !== donorId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status === DonationStatus.DRAFT) return { ok: false, error: "NOT_SCREENED" };
  if (donation.status !== DonationStatus.SCREENED) return { ok: false, error: "NOT_EDITABLE" };
  if (!donation.hasActiveFoodPhoto) return { ok: false, error: "PHOTO_REQUIRED" };

  // The rules are evaluateChecklist()'s, never re-implemented here.
  const flags: ChecklistFlags = {
    requiresPreparedTime: donation.requiresPreparedTime,
    requiresStorageInfo: donation.requiresStorageInfo,
  };
  // A missing checklist is evaluated as blank, so missing lists everything the
  // category needs (the same read getChecklist does).
  const answers: Partial<ChecklistAnswers> = donation.checklist ?? {};
  const evaluation = evaluateChecklist(flags, answers, donation.pickupEnd);
  if (donation.checklist === null || donation.checklist.completedAt === null || !evaluation.complete) {
    if (evaluation.violations.includes("CONSUME_BY_NOT_AFTER_PICKUP_END")) {
      return { ok: false, error: "CONSUME_BY_NOT_AFTER_PICKUP_END" };
    }
    return { ok: false, error: "CHECKLIST_INCOMPLETE", missing: evaluation.missing };
  }

  // donations_pickup_all_or_none keeps the three together; any null means the
  // donor skipped wizard step 3.
  if (donation.pickupAddressId === null || donation.pickupStart === null || donation.pickupEnd === null) {
    return { ok: false, error: "PICKUP_REQUIRED" };
  }
  if (donation.pickupStart <= now()) return { ok: false, error: "PICKUP_START_NOT_IN_FUTURE" };
  const expiresAt = donation.pickupEnd.toISOString();

  const qrToken = generateToken();
  const outcome = await transition({ donationId, donorId, qrToken });
  if (!outcome.ok) {
    // A concurrent change raced the checks: the donor sees "no longer" (or a
    // NOT_FOUND for an id that vanished), never the transition's message.
    if (outcome.error === "INVALID_TRANSITION") return { ok: false, error: "NOT_EDITABLE" };
    return { ok: false, error: "NOT_FOUND" };
  }
  return { ok: true, donationId, expiresAt };
}
