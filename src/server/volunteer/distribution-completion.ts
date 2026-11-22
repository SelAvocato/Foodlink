import { DonationStatus } from "@/contracts/enums";
import {
  progressFromTotals,
  type DistributionProgress,
} from "@/contracts/volunteer-distribution";
import type {
  DistributionDonation,
  DistributionTotals,
} from "./distribution-entries";

export type DistributionCompletionTotals = DistributionTotals & {
  entries: number;
};

export interface DistributionCompletionStore {
  readDonation(id: string): Promise<DistributionDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  getCompletionTotals(donationId: string): Promise<DistributionCompletionTotals>;
}

export type DistributionCompletionTransition = (input: {
  donationId: string;
  volunteerId: string;
}) => Promise<
  | { ok: true; closedAt: Date }
  | { ok: false; error: "NOT_FOUND" | "INVALID_STATE" | "RECONCILIATION_INCOMPLETE" }
>;

export type DistributionCompletionError =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "RECONCILIATION_INCOMPLETE";

export type DistributionCompletionResult =
  | {
      ok: true;
      status: typeof DonationStatus.CLOSED;
      closedAt: Date;
      progress: DistributionProgress;
    }
  | { ok: false; error: DistributionCompletionError };

export async function completeDistribution(
  deps: {
    store: DistributionCompletionStore;
    transition: DistributionCompletionTransition;
  },
  args: { volunteerId: string; donationId: string },
): Promise<DistributionCompletionResult> {
  const donation = await deps.store.readDonation(args.donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if ((await deps.store.findCurrentVolunteerId(args.donationId)) !== args.volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.DELIVERED) {
    return { ok: false, error: "INVALID_STATE" };
  }

  const totals = await deps.store.getCompletionTotals(args.donationId);
  if (
    totals.entries === 0 ||
    totals.distributed + totals.unusable !== donation.portions
  ) {
    return { ok: false, error: "RECONCILIATION_INCOMPLETE" };
  }

  const transitioned = await deps.transition({
    donationId: args.donationId,
    volunteerId: args.volunteerId,
  });
  if (!transitioned.ok) return { ok: false, error: transitioned.error };

  return {
    ok: true,
    status: DonationStatus.CLOSED,
    closedAt: transitioned.closedAt,
    progress: progressFromTotals(
      donation.portions,
      totals.distributed,
      totals.unusable,
    ),
  };
}
