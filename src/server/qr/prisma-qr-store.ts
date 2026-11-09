import { prisma } from "@/server/db";
import type { QrLabelRow, QrStore } from "./get-qr-label";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in get-qr-label.ts. One plain read selecting
// exactly the four columns the label needs: no qr_rotated_at, no pickup fields,
// no other donor's data.
export const prismaQrStore: QrStore = {
  async readQrLabel(id): Promise<QrLabelRow | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    // Deleted rows are returned: the service decides what deleted_at means.
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { donor_id: true, status: true, deleted_at: true, qr_token: true },
    });
    if (!donation) return null;
    return {
      donorId: donation.donor_id,
      status: donation.status,
      deletedAt: donation.deleted_at,
      qrToken: donation.qr_token,
    };
  },
};
