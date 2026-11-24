import type { AuthenticatedActor } from "@/contracts/authz";
import type { DistributionSummary } from "@/contracts/distribution";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";
import {
  authorizeDistributionRead,
  type DistributionDonation,
} from "./access";
import { computeDistributionSummary } from "./accounting";
import { toDistributionEntryView, type DistributionEntryRow } from "./entry-view";

export type DistributionReadTotals = {
  distributed: number;
  unusable: number;
  entryCount: number;
};

export interface DistributionReadStore {
  readDonation(id: string): Promise<DistributionDonation | null>;
  readTotals(donationId: string): Promise<DistributionReadTotals>;
  readEntries(donationId: string): Promise<DistributionEntryRow[]>;
}

export type DistributionEntriesError = "NOT_FOUND" | "INVALID_STATE";

export type DistributionEntriesResult =
  | {
      ok: true;
      summary: DistributionSummary;
      entries: DistributionEntryView[];
    }
  | { ok: false; error: DistributionEntriesError };

export async function getDistributionEntries(
  deps: { store: DistributionReadStore },
  args: { actor: AuthenticatedActor; donationId: string },
): Promise<DistributionEntriesResult> {
  const access = await authorizeDistributionRead(deps, args);
  if (!access.ok) return access;

  const { donation, viewerRole } = access;
  const [totals, rows] = await Promise.all([
    deps.store.readTotals(args.donationId),
    deps.store.readEntries(args.donationId),
  ]);

  const summary = computeDistributionSummary({
    donationId: donation.id,
    status: donation.status,
    totalQuantity: donation.portions,
    distributedQuantity: totals.distributed,
    unusableQuantity: totals.unusable,
    entryCount: totals.entryCount,
    viewerRole,
    isAssignedVolunteer: donation.currentVolunteerId === args.actor.id,
  });

  return {
    ok: true,
    summary,
    entries: rows.map(toDistributionEntryView),
  };
}
