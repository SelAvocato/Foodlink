import type { FoodOptionsStore } from "@/server/donor/food-options";
import { prisma } from "@/server/db";

/**
 * Thin adapter: one statement, one bound parameter. The role and the soft-delete
 * filter are literals in the SQL, so a row can only come back for a live Donor.
 * The list queries keep only is_active rows in seed order (id) and their
 * projections never name id or is_active, so neither can reach the service or
 * the response.
 */
export const prismaFoodOptionsStore: FoodOptionsStore = {
  async findDonorType(userId) {
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT u.donor_type::text AS donor_type
      FROM users u
      WHERE u.id = ${userId}::uuid AND u.role = 'DONOR' AND u.deleted_at IS NULL`;

    return rows[0] ?? null;
  },

  async listCategories() {
    return prisma.$queryRaw<unknown[]>`
      SELECT c.code, c.name, c.allowed_for_individuals,
             c.requires_prepared_time, c.requires_storage_info
      FROM food_categories c
      WHERE c.is_active = true
      ORDER BY c.id`;
  },

  async listAllergens() {
    return prisma.$queryRaw<unknown[]>`
      SELECT a.code, a.name
      FROM allergens a
      WHERE a.is_active = true
      ORDER BY a.id`;
  },

  async listDietaryTags() {
    return prisma.$queryRaw<unknown[]>`
      SELECT t.code, t.name
      FROM dietary_tags t
      WHERE t.is_active = true
      ORDER BY t.id`;
  },
};
