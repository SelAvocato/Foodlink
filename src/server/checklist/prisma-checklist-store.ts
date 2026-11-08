import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type { ChecklistStore, ChecklistTx, LockedDonation, ReadDonation, StoredChecklist } from "./donation-checklist";

type LockRow = {
  donor_id: string;
  status: string;
  pickup_end: Date | null;
  deleted_at: Date | null;
  requires_prepared_time: boolean;
  requires_storage_info: boolean;
};

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in donation-checklist.ts. updated_at is set
// explicitly here (the set_updated_at trigger would do the same on UPDATE).
function createTransactionAdapter(tx: typeof prisma): ChecklistTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE OF d: the checklist upsert must not race a pickup-window change.
      const rows = await tx.$queryRaw<LockRow[]>`
        SELECT d.donor_id,
               d.status::text AS status,
               d.pickup_end,
               d.deleted_at,
               cat.requires_prepared_time,
               cat.requires_storage_info
        FROM donations d
        JOIN food_categories cat ON cat.id = d.food_category_id
        WHERE d.id = ${id}::uuid
        FOR UPDATE OF d`;
      const row = rows[0];
      if (!row) return null;
      if (!DONATION_STATUSES.includes(row.status)) {
        throw new Error(`Unknown donation status on getDonationLocked: ${row.status}`);
      }
      const locked: LockedDonation = {
        donorId: row.donor_id,
        status: row.status as DonationStatus,
        pickupEnd: row.pickup_end,
        deletedAt: row.deleted_at,
        requiresPreparedTime: row.requires_prepared_time,
        requiresStorageInfo: row.requires_storage_info,
      };
      return locked;
    },
    async upsertChecklist(donationId, row) {
      const data = {
        prepared_at: row.preparedAt,
        consume_by_at: row.consumeByAt,
        storage_condition: row.storageCondition,
        storage_temperature_c: row.storageTemperatureC,
        packaging_intact: row.packagingIntact,
        allergens_confirmed: row.allergensConfirmed,
        not_customer_plate_leftovers: row.notCustomerPlateLeftovers,
        completed_at: row.completedAt,
        updated_at: new Date(),
      };
      await tx.donation_safety_checklists.upsert({
        where: { donation_id: donationId },
        create: { donation_id: donationId, ...data },
        update: data,
      });
    },
  };
}

export const prismaChecklistStore: ChecklistStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
  async readDonation(id): Promise<ReadDonation | null> {
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id, deleted_at: null },
      select: {
        donor_id: true,
        pickup_end: true,
        food_categories: { select: { requires_prepared_time: true, requires_storage_info: true } },
      },
    });
    if (!donation) return null;
    return {
      donorId: donation.donor_id,
      pickupEnd: donation.pickup_end,
      requiresPreparedTime: donation.food_categories.requires_prepared_time,
      requiresStorageInfo: donation.food_categories.requires_storage_info,
    };
  },
  async readChecklist(donationId): Promise<StoredChecklist | null> {
    if (!UUID_PATTERN.test(donationId)) return null;
    const row = await prisma.donation_safety_checklists.findUnique({
      where: { donation_id: donationId },
      select: {
        prepared_at: true,
        consume_by_at: true,
        storage_condition: true,
        storage_temperature_c: true,
        packaging_intact: true,
        allergens_confirmed: true,
        not_customer_plate_leftovers: true,
        completed_at: true,
        updated_at: true,
      },
    });
    if (!row) return null;
    return {
      preparedAt: row.prepared_at,
      consumeByAt: row.consume_by_at,
      storageCondition: row.storage_condition,
      // numeric(5,2) arrives as a Decimal; the contract speaks plain numbers.
      storageTemperatureC: row.storage_temperature_c === null ? null : Number(row.storage_temperature_c),
      packagingIntact: row.packaging_intact,
      allergensConfirmed: row.allergens_confirmed,
      notCustomerPlateLeftovers: row.not_customer_plate_leftovers,
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    };
  },
};
