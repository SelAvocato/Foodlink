import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type { DistributionDonation } from "./access";
import type { DistributionReadStore, DistributionReadTotals } from "./entries";
import type { DistributionEntryRow } from "./entry-view";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const donationStatusSchema = z.enum(DonationStatus);

type DonationRow = {
  id: string;
  status: string;
  deleted_at: Date | null;
  portions: number;
  current_volunteer_id: string | null;
};

type TotalsRow = {
  distributed: bigint | number;
  unusable: bigint | number;
  entry_count: bigint | number;
};

type EntryRow = {
  id: string;
  distributed_on: string;
  place: string;
  group_code: string;
  people_served: number;
  portions_distributed: number;
  portions_unusable: number;
  unusable_reason: string | null;
  notes: string | null;
};

function toDonation(row: DonationRow): DistributionDonation {
  return {
    id: row.id,
    status: donationStatusSchema.parse(row.status),
    deletedAt: row.deleted_at,
    portions: row.portions,
    currentVolunteerId: row.current_volunteer_id,
  };
}

function toEntryRow(row: EntryRow): DistributionEntryRow {
  return {
    id: row.id,
    distributedOn: row.distributed_on,
    place: row.place,
    groupCode: row.group_code,
    peopleServed: row.people_served,
    portionsDistributed: row.portions_distributed,
    portionsUnusable: row.portions_unusable,
    unusableReasonCode: row.unusable_reason,
    notes: row.notes,
  };
}

export const prismaDistributionReadStore: DistributionReadStore = {
  async readDonation(id) {
    if (!UUID_PATTERN.test(id)) return null;

    const rows = await prisma.$queryRaw<DonationRow[]>`
      SELECT d.id,
             d.status::text AS status,
             d.deleted_at,
             d.portions,
             COALESCE(
               (SELECT da.volunteer_id
                FROM donation_assignments da
                WHERE da.donation_id = d.id AND da.ended_at IS NULL
                LIMIT 1),
               (SELECT da.volunteer_id
                FROM donation_assignments da
                WHERE da.donation_id = d.id
                  AND d.status = 'CLOSED'::donation_status
                ORDER BY da.assigned_at DESC, da.id DESC
                LIMIT 1)
             ) AS current_volunteer_id
      FROM donations d
      WHERE d.id = ${id}::uuid
      LIMIT 1`;

    const row = rows[0];
    return row ? toDonation(row) : null;
  },

  async readTotals(donationId): Promise<DistributionReadTotals> {
    if (!UUID_PATTERN.test(donationId)) {
      return { distributed: 0, unusable: 0, entryCount: 0 };
    }

    const rows = await prisma.$queryRaw<TotalsRow[]>`
      SELECT
        COALESCE((SELECT sum(portions_distributed) FROM distribution_entries WHERE donation_id = ${donationId}::uuid), 0) AS distributed,
        COALESCE((SELECT sum(portions) FROM unusable_portions WHERE donation_id = ${donationId}::uuid), 0) AS unusable,
        (SELECT count(*) FROM distribution_entries WHERE donation_id = ${donationId}::uuid) AS entry_count`;

    return {
      distributed: Number(rows[0]?.distributed ?? 0),
      unusable: Number(rows[0]?.unusable ?? 0),
      entryCount: Number(rows[0]?.entry_count ?? 0),
    };
  },

  async readEntries(donationId) {
    if (!UUID_PATTERN.test(donationId)) return [];

    const rows = await prisma.$queryRaw<EntryRow[]>`
      SELECT e.id,
             to_char(e.distributed_on, 'YYYY-MM-DD') AS distributed_on,
             e.place,
             bg.code AS group_code,
             e.people_served,
             e.portions_distributed,
             COALESCE((SELECT sum(u.portions) FROM unusable_portions u WHERE u.entry_id = e.id), 0)::int AS portions_unusable,
             (SELECT u.reason::text FROM unusable_portions u WHERE u.entry_id = e.id ORDER BY u.created_at DESC LIMIT 1) AS unusable_reason,
             e.notes
      FROM distribution_entries e
      JOIN beneficiary_groups bg ON bg.id = e.group_id
      WHERE e.donation_id = ${donationId}::uuid
      ORDER BY e.distributed_on ASC, e.created_at ASC, e.id ASC`;

    return rows.map(toEntryRow);
  },
};
