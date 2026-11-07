import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type { DraftStore, DraftTx } from "./donation-drafts";

type DraftLockRow = { donor_id: string; status: string; food_category_id: number };

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// updated_at is left to the set_updated_at trigger in db/baseline/001_schema.sql.
function createTransactionAdapter(tx: typeof prisma): DraftTx {
  return {
    async getDonor(userId) {
      const user = await tx.users.findFirst({
        where: { id: userId, deleted_at: null },
        select: { role: true, status: true, donor_type: true },
      });
      if (!user) return null;
      return { role: user.role, status: user.status, donorType: user.donor_type };
    },
    async getCategory(code) {
      const category = await tx.food_categories.findFirst({
        where: { code },
        select: { id: true, is_active: true, allowed_for_individuals: true },
      });
      if (!category) return null;
      return {
        id: category.id,
        isActive: category.is_active,
        allowedForIndividuals: category.allowed_for_individuals,
      };
    },
    async getAllergens(codes) {
      return tx.allergens.findMany({
        where: { code: { in: codes }, is_active: true },
        select: { id: true, code: true },
      });
    },
    async getDietaryTags(codes) {
      return tx.dietary_tags.findMany({
        where: { code: { in: codes }, is_active: true },
        select: { id: true, code: true },
      });
    },
    async insertDraft(row) {
      return tx.donations.create({
        data: {
          donor_id: row.donorId,
          food_category_id: row.foodCategoryId,
          food_name: row.foodName,
          description: row.description,
          portions: row.portions,
        },
        select: { id: true },
      });
    },
    async getDraft(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such draft".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE: the allergen and tag writes are not guarded by a conditional update.
      const rows = await tx.$queryRaw<DraftLockRow[]>`
        SELECT donor_id, status::text AS status, food_category_id
        FROM donations
        WHERE id = ${id}::uuid AND deleted_at IS NULL
        FOR UPDATE`;
      const row = rows[0];
      if (!row) return null;
      if (!DONATION_STATUSES.includes(row.status)) {
        throw new Error(`Unknown donation status on getDraft: ${row.status}`);
      }
      return {
        donorId: row.donor_id,
        status: row.status as DonationStatus,
        foodCategoryId: row.food_category_id,
      };
    },
    async updateDraft(id, donorId, allowedStatuses, fields) {
      const data: {
        food_name?: string;
        description?: string | null;
        portions?: number;
        food_category_id?: number;
      } = {};
      if (fields.foodName !== undefined) data.food_name = fields.foodName;
      if (fields.description !== undefined) data.description = fields.description;
      if (fields.portions !== undefined) data.portions = fields.portions;
      if (fields.foodCategoryId !== undefined) data.food_category_id = fields.foodCategoryId;
      const updated = await tx.donations.updateMany({
        where: { id, donor_id: donorId, status: { in: [...allowedStatuses] }, deleted_at: null },
        data,
      });
      return updated.count === 1;
    },
    async replaceAllergens(donationId, allergenIds) {
      await tx.donation_allergens.deleteMany({ where: { donation_id: donationId } });
      if (allergenIds.length > 0) {
        await tx.donation_allergens.createMany({
          data: allergenIds.map((allergen_id) => ({ donation_id: donationId, allergen_id })),
        });
      }
    },
    async replaceDietaryTags(donationId, tagIds) {
      await tx.donation_dietary_tags.deleteMany({ where: { donation_id: donationId } });
      if (tagIds.length > 0) {
        await tx.donation_dietary_tags.createMany({
          data: tagIds.map((dietary_tag_id) => ({ donation_id: donationId, dietary_tag_id })),
        });
      }
    },
    async softDeleteDraft(id, donorId, allowedStatuses) {
      const updated = await tx.donations.updateMany({
        where: { id, donor_id: donorId, status: { in: [...allowedStatuses] }, deleted_at: null },
        data: { deleted_at: new Date() },
      });
      return updated.count === 1;
    },
  };
}

export const prismaDraftStore: DraftStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
};
