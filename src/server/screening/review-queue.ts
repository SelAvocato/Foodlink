import { safeErrorSummary } from "@/lib/safe-error";
import type { ScreeningQueueChecklist, ScreeningQueueItem } from "@/contracts/screening-queue";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";

/**
 * One food_screenings row of a candidate donation with everything the queue
 * shows, as stored. The rule fields (verdict, reviewedAt, donationStatus,
 * deletedAt) travel too so the service can re-check the rules it is given, and
 * photoKey stays server-side — it never reaches the response.
 */
export type ReviewQueueRow = {
  screeningId: string;
  donationId: string;
  verdict: ScreeningVerdict;
  reviewedAt: Date | null;
  createdAt: Date;
  confidence: number | null;
  signs: string[];
  notes: string | null;
  donationStatus: DonationStatus;
  deletedAt: Date | null;
  foodName: string;
  portions: number;
  categoryCode: string;
  checklist: ScreeningQueueChecklist | null;
  photoKey: string | null;
};

export interface ReviewQueueStore {
  /** Plain reads outside any transaction: a queue is a snapshot, the decision route re-reads. */
  listPending(limit: number): Promise<ReviewQueueRow[]>;
}

/** Newest first within a donation: the later createdAt wins, id breaks a tie. */
function isNewer(candidate: ReviewQueueRow, incumbent: ReviewQueueRow): boolean {
  const delta = candidate.createdAt.getTime() - incumbent.createdAt.getTime();
  if (delta !== 0) return delta > 0;
  return candidate.screeningId > incumbent.screeningId;
}

/** Oldest case first, id as the tiebreak (the same order the store selects in). */
function oldestFirst(a: ReviewQueueRow, b: ReviewQueueRow): number {
  const delta = a.createdAt.getTime() - b.createdAt.getTime();
  if (delta !== 0) return delta;
  return a.screeningId < b.screeningId ? -1 : a.screeningId > b.screeningId ? 1 : 0;
}

/**
 * The Admin's screening review queue: donations whose latest screening is an
 * unreviewed REVIEW on a live DRAFT, oldest first, each with a short-lived
 * signed photo URL. The store pre-selects pending cases; every rule is
 * re-checked here, one failing URL nulls that item's photoUrl instead of
 * dropping the case, and neither the storage key nor the URL is ever logged.
 */
export async function listScreeningQueue(
  deps: { store: ReviewQueueStore; signPhoto: (storageKey: string) => Promise<string> },
  input: { limit: number },
): Promise<ScreeningQueueItem[]> {
  const rows = await deps.store.listPending(input.limit);

  // Re-check every rule on what the store returned: a discarded draft, a
  // non-DRAFT donation, a decided screening or another verdict is not pending.
  const eligible = rows.filter(
    (row) =>
      row.deletedAt === null &&
      row.donationStatus === DonationStatus.DRAFT &&
      row.verdict === ScreeningVerdict.REVIEW &&
      row.reviewedAt === null,
  );

  // A donation with a newer screening row for the same donation is not pending:
  // keep only the newest row of each donation (created_at, then id).
  const latestByDonation = new Map<string, ReviewQueueRow>();
  for (const row of eligible) {
    const incumbent = latestByDonation.get(row.donationId);
    if (!incumbent || isNewer(row, incumbent)) latestByDonation.set(row.donationId, row);
  }

  const pending = [...latestByDonation.values()].sort(oldestFirst).slice(0, input.limit);

  // Sign every photo URL concurrently: with a limit of 100 that is one round of
  // storage calls instead of up to 100 sequential ones. Promise.all keeps the
  // oldest-first order of `pending` no matter which URL resolves first.
  return Promise.all(
    pending.map(async (row) => {
      let photoUrl: string | null = null;
      if (row.photoKey !== null) {
        try {
          photoUrl = await deps.signPhoto(row.photoKey);
        } catch (error) {
          // One failed URL must not drop the case: the Admin still sees the rest
          // of the queue. The log carries the screening id and safe tokens only,
          // never the raw message (it can contain the key or a signed URL).
          console.error("Screening photo URL failed", {
            screeningId: row.screeningId,
            ...safeErrorSummary(error),
          });
        }
      }
      return {
        screeningId: row.screeningId,
        donationId: row.donationId,
        createdAt: row.createdAt,
        confidence: row.confidence,
        signs: row.signs,
        notes: row.notes,
        donation: {
          foodName: row.foodName,
          portions: row.portions,
          categoryCode: row.categoryCode,
        },
        checklist: row.checklist,
        photoUrl,
      };
    }),
  );
}
