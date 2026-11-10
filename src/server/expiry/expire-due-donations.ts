import type { DonationStatus } from "@/contracts/enums";
import type { TransitionDonationPayload } from "@/contracts/donation";
import { DonationTransitionError } from "@/server/donations/transition-donation";
import { safeErrorSummary } from "@/lib/safe-error";

export interface DueDonationStore {
  listDue(limit: number): Promise<Array<{ donationId: string; status: DonationStatus; pickupEnd: Date }>>;
}

export type ExpiryTransition = (
  id: string,
  to: "EXPIRED",
  actor: null,
  payload?: TransitionDonationPayload,
) => Promise<{ from: DonationStatus; to: DonationStatus }>;

export type ExpireDueResult = {
  expired: number;
  skipped: number;
  failed: number;
};

export async function expireDueDonations(
  deps: { store: DueDonationStore; transition: ExpiryTransition },
  limit = 200,
): Promise<ExpireDueResult> {
  const due = await deps.store.listDue(limit);
  let expired = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of due) {
    try {
      await deps.transition(row.donationId, "EXPIRED", null);
      expired += 1;
    } catch (error) {
      if (
        error instanceof DonationTransitionError &&
        (error.code === "INVALID_TRANSITION" || error.code === "NOT_FOUND")
      ) {
        skipped += 1;
        continue;
      }
      console.error("Expiry cron failed for a donation", { donationId: row.donationId, ...safeErrorSummary(error) });
      failed += 1;
    }
  }

  return { expired, skipped, failed };
}
