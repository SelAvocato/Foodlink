import { prisma } from "@/server/db";
import type { CancelDonationRow, CancelStore } from "./cancel-donation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in cancel-donation.ts. One plain read of the
// three columns the service needs, nothing from the exit, assignment or user rows.
export const prismaCancelStore: CancelStore = {
  async readDonation(id): Promise<CancelDonationRow | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    // Deleted rows are returned: the service decides what deleted_at means.
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { donor_id: true, status: true, deleted_at: true },
    });
    if (!donation) return null;
    return {
      donorId: donation.donor_id,
      status: donation.status,
      deletedAt: donation.deleted_at,
    };
  },
};
