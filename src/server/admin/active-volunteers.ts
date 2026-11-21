import type { AdminActiveVolunteerItem } from "@/contracts/admin-active-volunteers";
import type { AccountStatus, Role } from "@/contracts/enums";

/** What the Prisma store selects; the service re-checks the assign conditions. */
export interface ActiveVolunteerRow {
  id: string;
  fullName: string;
  availability: string | null;
  role: Role;
  status: AccountStatus;
  deletedAt: Date | null;
}

export interface ActiveVolunteersStore {
  /** ACTIVE, non-deleted volunteers ordered by full name then id, at most `limit`. */
  findActiveVolunteers(limit: number): Promise<ActiveVolunteerRow[]>;
}

/** Code-point order, so the list does not depend on the runtime locale. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Admin-wide list, so there is no ownership check here: the route has already
 * verified the Admin role. The conditions are the ones transitionDonation checks
 * before an assignment (role VOLUNTEER, status ACTIVE, not soft-deleted); the
 * store filters them too and the service re-checks so a misbehaving store cannot
 * widen the list. The store orders by full name then id; the service sorts the
 * same way and trims to the limit.
 */
export async function listActiveVolunteers(
  deps: { store: ActiveVolunteersStore },
  input: { limit: number },
): Promise<AdminActiveVolunteerItem[]> {
  const rows = await deps.store.findActiveVolunteers(input.limit);

  return rows
    .filter((row) => row.role === "VOLUNTEER" && row.status === "ACTIVE" && row.deletedAt === null)
    .sort((a, b) => compareText(a.fullName, b.fullName) || compareText(a.id, b.id))
    .slice(0, input.limit)
    .map((row) => ({
      volunteerId: row.id,
      fullName: row.fullName,
      availability: row.availability,
    }));
}
