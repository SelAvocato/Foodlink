import { prisma } from "@/server/db";
import type { ChecklistDonation, ChecklistReadStore, StoredChecklist } from "./checklist-read";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the access rules live in checklist-read.ts.
export const prismaChecklistReadStore: ChecklistReadStore = {
  async readDonation(id): Promise<ChecklistDonation | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { status: true, deleted_at: true },
    });
    if (!donation) return null;
    return { status: donation.status, deletedAt: donation.deleted_at };
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
      },
    });
    if (!row) return null;
    return {
      preparedAt: row.prepared_at,
      consumeByAt: row.consume_by_at,
      storageCondition: row.storage_condition,
      // numeric(5,2) arrives as a Decimal; the contract speaks plain numbers.
      storageTemperatureC:
        row.storage_temperature_c === null ? null : Number(row.storage_temperature_c),
      packagingIntact: row.packaging_intact,
      allergensConfirmed: row.allergens_confirmed,
      notCustomerPlateLeftovers: row.not_customer_plate_leftovers,
    };
  },

  async readAllergenNames(donationId) {
    if (!UUID_PATTERN.test(donationId)) return [];
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT al.name
      FROM donation_allergens da
      JOIN allergens al ON al.id = da.allergen_id
      WHERE da.donation_id = ${donationId}::uuid
      ORDER BY al.name`;
    return rows.map((row) => row.name);
  },
};
