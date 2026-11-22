import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import {
  GROUP_SERVED_DB_CODE,
  UNUSABLE_REASON_DB_CODE,
  groupServedFromDbCode,
  unusableReasonFromDbCode,
  type DistributionEntryView,
} from "@/contracts/volunteer-distribution";
import { prisma } from "@/server/db";
import type {
  DistributionDonation,
  DistributionEntryStore,
  DistributionEntryTx,
  DistributionEntryUpdate,
  DistributionEntryWrite,
  DistributionTotals,
} from "./distribution-entries";

const donationStatusSchema = z.enum(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DonationRow = {
  id: string;
  status: string;
  deleted_at: Date | null;
  portions: number;
};

type EntryRow = {
  id: string;
  distributed_on: string;
  place: string;
  group_code: string;
  people_served: number;
  portions_distributed: number;
  notes: string | null;
  portions_unusable: number | null;
  unusable_reason: string | null;
};

type TotalsRow = {
  distributed: bigint | number;
  unusable: bigint | number;
};

function toEntry(row: EntryRow): DistributionEntryView {
  const groupServed = groupServedFromDbCode(row.group_code);
  if (!groupServed) {
    throw new Error(`Unknown beneficiary group code: ${row.group_code}`);
  }
  const unusableReason = row.unusable_reason
    ? unusableReasonFromDbCode(row.unusable_reason)
    : null;
  if (row.unusable_reason && !unusableReason) {
    throw new Error(`Unknown unusable reason: ${row.unusable_reason}`);
  }
  return {
    id: row.id,
    date: row.distributed_on,
    place: row.place,
    groupServed,
    peopleServed: row.people_served,
    portionsDistributed: row.portions_distributed,
    portionsUnusable: row.portions_unusable ?? 0,
    unusableReason,
    notes: row.notes,
  };
}

async function findCurrentVolunteerIdIn(
  db: typeof prisma,
  donationId: string,
): Promise<string | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const rows = await db.$queryRaw<{ volunteer_id: string }[]>`
    SELECT volunteer_id
    FROM donation_assignments
    WHERE donation_id = ${donationId}::uuid AND ended_at IS NULL
    LIMIT 1`;
  return rows[0]?.volunteer_id ?? null;
}

async function getTotalsIn(
  db: typeof prisma,
  donationId: string,
): Promise<DistributionTotals> {
  if (!UUID_PATTERN.test(donationId)) return { distributed: 0, unusable: 0 };
  const rows = await db.$queryRaw<TotalsRow[]>`
    SELECT
      COALESCE((SELECT sum(portions_distributed) FROM distribution_entries WHERE donation_id = ${donationId}::uuid), 0) AS distributed,
      COALESCE((SELECT sum(portions) FROM unusable_portions WHERE donation_id = ${donationId}::uuid), 0) AS unusable`;
  return {
    distributed: Number(rows[0]?.distributed ?? 0),
    unusable: Number(rows[0]?.unusable ?? 0),
  };
}

async function findEntryIn(
  tx: typeof prisma,
  donationId: string,
  entryId: string,
): Promise<DistributionEntryView | null> {
  if (!UUID_PATTERN.test(donationId) || !UUID_PATTERN.test(entryId)) return null;
  const rows = await tx.$queryRaw<EntryRow[]>`
    SELECT e.id,
           to_char(e.distributed_on, 'YYYY-MM-DD') AS distributed_on,
           e.place,
           bg.code AS group_code,
           e.people_served,
            e.portions_distributed,
            e.notes,
            COALESCE((SELECT sum(u.portions) FROM unusable_portions u WHERE u.entry_id = e.id), 0)::int AS portions_unusable,
            (SELECT u.reason::text FROM unusable_portions u WHERE u.entry_id = e.id ORDER BY u.created_at DESC LIMIT 1) AS unusable_reason
    FROM distribution_entries e
    JOIN beneficiary_groups bg ON bg.id = e.group_id
    WHERE e.donation_id = ${donationId}::uuid AND e.id = ${entryId}::uuid
    LIMIT 1`;
  return rows[0] ? toEntry(rows[0]) : null;
}

async function insertUnusableIn(
  tx: typeof prisma,
  input: {
    entryId: string;
    donationId: string;
    portions: number;
    reason: string;
    note: string | null;
    recordedByUserId: string;
  },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO unusable_portions (donation_id, entry_id, portions, reason, note, recorded_by_user_id)
    VALUES (
      ${input.donationId}::uuid,
      ${input.entryId}::uuid,
      ${input.portions},
      ${input.reason}::unusable_reason,
      ${input.note},
      ${input.recordedByUserId}::uuid
    )`;
}

async function insertEntryIn(
  tx: typeof prisma,
  input: DistributionEntryWrite,
): Promise<DistributionEntryView> {
  if (!UUID_PATTERN.test(input.donationId) || !UUID_PATTERN.test(input.recordedByUserId)) {
    throw new Error("Invalid distribution entry ids");
  }
  const rows = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO distribution_entries (
      donation_id, distributed_on, place, group_id, people_served,
      portions_distributed, notes, recorded_by_user_id
    )
    SELECT
      ${input.donationId}::uuid,
      ${input.date}::date,
      ${input.place},
      bg.id,
      ${input.peopleServed},
      ${input.portionsDistributed},
      ${input.notes},
      ${input.recordedByUserId}::uuid
    FROM beneficiary_groups bg
    WHERE bg.code = ${GROUP_SERVED_DB_CODE[input.groupServed]}
    RETURNING id`;
  const inserted = rows[0];
  if (!inserted) throw new Error("Unknown beneficiary group code");

  if (input.portionsUnusable > 0 && input.unusableReason) {
    await insertUnusableIn(tx, {
      entryId: inserted.id,
      donationId: input.donationId,
      portions: input.portionsUnusable,
      reason: UNUSABLE_REASON_DB_CODE[input.unusableReason],
      note: input.notes,
      recordedByUserId: input.recordedByUserId,
    });
  }

  const entry = await findEntryIn(tx, input.donationId, inserted.id);
  if (!entry) throw new Error("Inserted distribution entry could not be read back");
  return entry;
}

async function updateEntryIn(
  tx: typeof prisma,
  input: DistributionEntryUpdate,
): Promise<DistributionEntryView | null> {
  if (
    !UUID_PATTERN.test(input.donationId) ||
    !UUID_PATTERN.test(input.entryId) ||
    !UUID_PATTERN.test(input.recordedByUserId)
  ) {
    return null;
  }

  await tx.$executeRaw`
    DELETE FROM unusable_portions
    WHERE entry_id = ${input.entryId}::uuid AND donation_id = ${input.donationId}::uuid`;

  const updated = await tx.$executeRaw`
    UPDATE distribution_entries e
    SET distributed_on = ${input.date}::date,
        place = ${input.place},
        group_id = bg.id,
        people_served = ${input.peopleServed},
        portions_distributed = ${input.portionsDistributed},
        notes = ${input.notes},
        recorded_by_user_id = ${input.recordedByUserId}::uuid
    FROM beneficiary_groups bg
    WHERE e.id = ${input.entryId}::uuid
      AND e.donation_id = ${input.donationId}::uuid
      AND bg.code = ${GROUP_SERVED_DB_CODE[input.groupServed]}`;
  if (updated !== 1) {
    throw new Error("Distribution entry update affected no rows");
  }

  if (input.portionsUnusable > 0 && input.unusableReason) {
    await insertUnusableIn(tx, {
      entryId: input.entryId,
      donationId: input.donationId,
      portions: input.portionsUnusable,
      reason: UNUSABLE_REASON_DB_CODE[input.unusableReason],
      note: input.notes,
      recordedByUserId: input.recordedByUserId,
    });
  }

  return findEntryIn(tx, input.donationId, input.entryId);
}

function createTransactionAdapter(tx: typeof prisma): DistributionEntryTx {
  return {
    async getDonationLocked(id) {
      if (!UUID_PATTERN.test(id)) return null;
      const rows = await tx.$queryRaw<DonationRow[]>`
        SELECT d.id, d.status::text AS status, d.deleted_at, d.portions
        FROM donations d
        WHERE d.id = ${id}::uuid
        FOR UPDATE OF d`;
      const row = rows[0];
      if (!row) return null;
      const status = donationStatusSchema.parse(row.status);
      const donation: DistributionDonation = {
        id: row.id,
        status,
        deletedAt: row.deleted_at,
        portions: row.portions,
      };
      return donation;
    },
    findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(tx, donationId),
    findEntry: (donationId, entryId) => findEntryIn(tx, donationId, entryId),
    insertEntry: (input) => insertEntryIn(tx, input),
    updateEntry: (input) => updateEntryIn(tx, input),
    async deleteEntry(donationId, entryId) {
      if (!UUID_PATTERN.test(donationId) || !UUID_PATTERN.test(entryId)) return false;
      const deleted = await tx.$executeRaw`
        DELETE FROM distribution_entries
        WHERE id = ${entryId}::uuid AND donation_id = ${donationId}::uuid`;
      return deleted === 1;
    },
    getTotals: (donationId) => getTotalsIn(tx, donationId),
  };
}

export const prismaDistributionEntryStore: DistributionEntryStore = {
  async readDonation(id) {
    if (!UUID_PATTERN.test(id)) return null;
    const rows = await prisma.$queryRaw<DonationRow[]>`
      SELECT d.id, d.status::text AS status, d.deleted_at, d.portions
      FROM donations d
      WHERE d.id = ${id}::uuid
      LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      status: donationStatusSchema.parse(row.status),
      deletedAt: row.deleted_at,
      portions: row.portions,
    };
  },
  findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(prisma, donationId),
  transaction(work) {
    return prisma.$transaction(
      async (tx) => work(createTransactionAdapter(tx as typeof prisma)),
      { maxWait: 10000, timeout: 30000 },
    );
  },
};
