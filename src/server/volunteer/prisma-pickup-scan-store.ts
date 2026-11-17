import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type { PickupScanStore, RecordedScan } from "./pickup-scan";

type DonationRow = {
  id: string;
  status: string;
  pickup_end: Date | null;
  deleted_at: Date | null;
};

type ScanRow = {
  scanned_at: Date;
  scanned_by_user_id: string;
  inserted: boolean;
};

const donationStatusSchema = z.enum(DonationStatus);

/**
 * Thin adapter over donations, donation_assignments and donation_qr_scans. The
 * insert is conditional on the donation still being ASSIGNED, so a concurrent
 * transition cannot record a scan on a donation that already moved on. One scan
 * per donation and stage: a repeat is a conflict, and the existing row is read
 * back so the service can answer idempotently.
 */
export const prismaPickupScanStore: PickupScanStore = {
  async findByQrToken(token) {
    const rows = await prisma.$queryRaw<DonationRow[]>`
      SELECT id, status::text AS status, pickup_end, deleted_at
      FROM donations
      WHERE qr_token = ${token}
      LIMIT 1`;

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: donationStatusSchema.parse(row.status),
      pickupEnd: row.pickup_end,
      deletedAt: row.deleted_at,
    };
  },

  async findCurrentVolunteerId(donationId) {
    const rows = await prisma.$queryRaw<{ volunteer_id: string }[]>`
      SELECT volunteer_id
      FROM donation_assignments
      WHERE donation_id = ${donationId}::uuid AND ended_at IS NULL
      LIMIT 1`;

    return rows[0]?.volunteer_id ?? null;
  },

  async recordScan({ donationId, stage, scannedByUserId }) {
    // The CTE returns the new row, or the existing one when the insert lost the
    // race or the donation is no longer ASSIGNED. No row means neither happened.
    const rows = await prisma.$queryRaw<ScanRow[]>`
      WITH inserted AS (
        INSERT INTO donation_qr_scans (donation_id, stage, scanned_by_user_id)
        SELECT d.id, ${stage}::qr_scan_stage, ${scannedByUserId}::uuid
        FROM donations d
        WHERE d.id = ${donationId}::uuid
          AND d.status = 'ASSIGNED'
          AND d.deleted_at IS NULL
        ON CONFLICT (donation_id, stage) DO NOTHING
        RETURNING scanned_at, scanned_by_user_id, true AS inserted
      )
      SELECT scanned_at, scanned_by_user_id, inserted FROM inserted
      UNION ALL
      SELECT q.scanned_at, q.scanned_by_user_id, false AS inserted
      FROM donation_qr_scans q
      WHERE q.donation_id = ${donationId}::uuid
        AND q.stage = ${stage}::qr_scan_stage
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1`;

    const row = rows[0];
    if (!row) return null;
    const scan: RecordedScan = {
      inserted: row.inserted,
      scannedAt: row.scanned_at,
      scannedByUserId: row.scanned_by_user_id,
    };
    return scan;
  },
};
