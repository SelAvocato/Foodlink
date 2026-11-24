import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";

export type DistributionDonation = {
  id: string;
  status: DonationStatus;
  deletedAt: Date | null;
  portions: number;
  currentVolunteerId: string | null;
};

export interface DistributionAccessStore {
  readDonation(id: string): Promise<DistributionDonation | null>;
}

export type DistributionViewerRole = "VOLUNTEER" | "ADMIN";

export type DistributionAccessError = "NOT_FOUND" | "INVALID_STATE";

export type DistributionAccessResult =
  | {
      ok: true;
      viewerRole: DistributionViewerRole;
      donation: DistributionDonation;
    }
  | { ok: false; error: DistributionAccessError };

const READABLE_STATUSES: ReadonlySet<DonationStatus> = new Set([
  DonationStatus.DELIVERED,
  DonationStatus.CLOSED,
]);

export async function authorizeDistributionRead(
  deps: { store: DistributionAccessStore },
  args: { actor: AuthenticatedActor; donationId: string },
): Promise<DistributionAccessResult> {
  const donation = await deps.store.readDonation(args.donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }

  if (args.actor.role === "ADMIN") {
    if (!READABLE_STATUSES.has(donation.status)) {
      return { ok: false, error: "INVALID_STATE" };
    }
    return { ok: true, viewerRole: "ADMIN", donation };
  }

  if (donation.currentVolunteerId !== args.actor.id) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (!READABLE_STATUSES.has(donation.status)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  return { ok: true, viewerRole: "VOLUNTEER", donation };
}
