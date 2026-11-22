import type { AdminAcceptedDonationItem } from "@/contracts/admin-accepted-donations";
import type { DonationStatus } from "@/contracts/enums";

/** What the Prisma store selects; the service re-checks status, deletion and time. */
export interface AcceptedDonationRow {
  donationId: string;
  foodName: string;
  portions: number;
  donorBusinessName: string | null;
  donorFullName: string;
  status: DonationStatus;
  pickupEnd: Date | null;
  deletedAt: Date | null;
}

export interface AcceptedDonationsStore {
  /** ACCEPTED, non-deleted donations whose pickup end is after `now`, soonest first. */
  findAcceptedDonations(now: Date, limit: number): Promise<AcceptedDonationRow[]>;
}

type LiveRow = AcceptedDonationRow & { pickupEnd: Date };

function isLive(row: AcceptedDonationRow, now: Date): row is LiveRow {
  return (
    row.status === "ACCEPTED" &&
    row.deletedAt === null &&
    row.pickupEnd !== null &&
    row.pickupEnd.getTime() > now.getTime()
  );
}

/** Code-point order, so the tie-break does not depend on the runtime locale. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Admin-wide list, so there is no ownership check here: the route has already
 * verified the Admin role. The clock comes from the caller and is never read
 * inside the service, so tests can fix it. The expiry job moves ACCEPTED rows
 * past their pickup end to EXPIRED every 15 minutes, so an ACCEPTED row can
 * briefly be past its pickup end; the service re-checks the pickup end (and
 * status and deletion) so a misbehaving store cannot widen the list.
 */
export async function listAcceptedDonations(
  deps: { store: AcceptedDonationsStore },
  input: { now: Date; limit: number },
): Promise<AdminAcceptedDonationItem[]> {
  const rows = await deps.store.findAcceptedDonations(input.now, input.limit);

  return rows
    .filter((row): row is LiveRow => isLive(row, input.now))
    .sort(
      (a, b) =>
        a.pickupEnd.getTime() - b.pickupEnd.getTime() || compareText(a.donationId, b.donationId),
    )
    .slice(0, input.limit)
    .map((row) => ({
      donationId: row.donationId,
      foodName: row.foodName,
      portions: row.portions,
      // The fn_donation_report rule: business name when present, else full name.
      donorName: row.donorBusinessName ?? row.donorFullName,
      pickupEnd: row.pickupEnd,
    }));
}
