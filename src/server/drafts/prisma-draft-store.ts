import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import { DRAFT_LIST_LIMIT, type DraftListRow, type DraftStore, type DraftTx } from "./donation-drafts";

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
  async listDrafts(donorId) {
    // Plain read, no transaction. Only the columns the list returns or filters on:
    // no qr_token, no pickup fields, nothing from users. deleted_at is selected
    // because the service re-checks soft deletion on its side.
    const donations = await prisma.donations.findMany({
      where: {
        donor_id: donorId,
        status: { in: [DonationStatus.DRAFT, DonationStatus.SCREENED] },
        deleted_at: null,
      },
      orderBy: { updated_at: "desc" },
      take: DRAFT_LIST_LIMIT,
      select: {
        id: true,
        donor_id: true,
        food_name: true,
        description: true,
        portions: true,
        status: true,
        deleted_at: true,
        created_at: true,
        updated_at: true,
        food_categories: { select: { code: true } },
        donation_allergens: { select: { allergens: { select: { code: true } } } },
        donation_dietary_tags: { select: { dietary_tags: { select: { code: true } } } },
      },
    });

    return donations.map((donation): DraftListRow => ({
      id: donation.id,
      donorId: donation.donor_id,
      foodName: donation.food_name,
      description: donation.description,
      portions: donation.portions,
      status: donation.status,
      foodCategoryCode: donation.food_categories.code,
      allergenCodes: donation.donation_allergens.map((row) => row.allergens.code),
      dietaryTagCodes: donation.donation_dietary_tags.map((row) => row.dietary_tags.code),
      deletedAt: donation.deleted_at,
      createdAt: donation.created_at,
      updatedAt: donation.updated_at,
    }));
  },
};
