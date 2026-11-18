import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type {
  DropoffScanStore,
  RecordedDropoffScan,
} from "./dropoff-scan";

type DonationRow = {
  id: string;
  status: string;
  deleted_at: Date | null;
};

type ScanRow = {
  scanned_at: Date;
  scanned_by_user_id: string;
  inserted: boolean;
};

const donationStatusSchema = z.enum(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecordedScan(row: ScanRow): RecordedDropoffScan {
  return {
    inserted: row.inserted,
    scannedAt: row.scanned_at,
    scannedByUserId: row.scanned_by_user_id,
  };
}

/**
 * Thin adapter over donations, donation_assignments and donation_qr_scans. The
 * insert is conditional on the donation still being PICKED_UP, so a concurrent
 * transition cannot record a scan on a donation that already moved on. One scan
 * per donation and stage: a repeat is a conflict, and the existing row is read
 * back so the service can answer idempotently.
 */
export const prismaDropoffScanStore: DropoffScanStore = {
  async findByQrToken(token) {
    const rows = await prisma.$queryRaw<DonationRow[]>`
      SELECT id, status::text AS status, deleted_at
      FROM donations
      WHERE qr_token = ${token}
      LIMIT 1`;

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: donationStatusSchema.parse(row.status),
      deletedAt: row.deleted_at,
    };
  },

  async findCurrentVolunteerId(donationId) {
    if (!UUID_PATTERN.test(donationId)) return null;
    const rows = await prisma.$queryRaw<{ volunteer_id: string }[]>`
      SELECT volunteer_id
      FROM donation_assignments
      WHERE donation_id = ${donationId}::uuid AND ended_at IS NULL
      LIMIT 1`;

    return rows[0]?.volunteer_id ?? null;
  },

  async findScan(donationId, volunteerId) {
    if (!UUID_PATTERN.test(donationId) || !UUID_PATTERN.test(volunteerId)) return null;
    const rows = await prisma.$queryRaw<ScanRow[]>`
      SELECT scanned_at, scanned_by_user_id, false AS inserted
      FROM donation_qr_scans
      WHERE donation_id = ${donationId}::uuid
        AND stage = 'DROPOFF'
        AND scanned_by_user_id = ${volunteerId}::uuid
      LIMIT 1`;

    const row = rows[0];
    return row ? { scannedAt: row.scanned_at, scannedByUserId: row.scanned_by_user_id } : null;
  },

  async recordScan({ donationId, scannedByUserId }) {
    if (!UUID_PATTERN.test(donationId) || !UUID_PATTERN.test(scannedByUserId)) return null;
    // One transaction so the row lock survives until the scan is written: a
    // transition or soft delete either commits before the lock (and no scan is
    // written) or waits for it.
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM donations
        WHERE id = ${donationId}::uuid
          AND status = 'PICKED_UP'
          AND deleted_at IS NULL
        FOR UPDATE`;

      if (!locked[0]) return null;

      const inserted = await tx.$queryRaw<ScanRow[]>`
        INSERT INTO donation_qr_scans (donation_id, stage, scanned_by_user_id)
        VALUES (${donationId}::uuid, 'DROPOFF'::qr_scan_stage, ${scannedByUserId}::uuid)
        ON CONFLICT (donation_id, stage) DO NOTHING
        RETURNING scanned_at, scanned_by_user_id, true AS inserted`;

      if (inserted[0]) return toRecordedScan(inserted[0]);

      // A separate statement in READ COMMITTED takes a fresh snapshot, so it
      // sees the row committed by a concurrent winner that ON CONFLICT skipped.
      const existing = await tx.$queryRaw<ScanRow[]>`
        SELECT scanned_at, scanned_by_user_id, false AS inserted
        FROM donation_qr_scans
        WHERE donation_id = ${donationId}::uuid
          AND stage = 'DROPOFF'
        LIMIT 1`;

      const row = existing[0];
      if (!row) return null;
      return toRecordedScan(row);
    });
  },
};
