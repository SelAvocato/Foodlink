import { z } from "zod";
import type { AdminDonationQueueStore } from "@/server/admin/donation-queue";
import { prisma } from "@/server/db";

type QueueRow = {
  donation_id: string;
  food_name: string;
  category: string;
  portions: number;
  donor_name: string;
  donor_type: string;
  pickup_address: string | null;
  pickup_start: Date | null;
  pickup_end: Date | null;
  posted_at: Date | null;
};

const donorTypeSchema = z.enum(["ESTABLISHMENT", "INDIVIDUAL"]);

/**
 * Thin adapter over fn_admin_donation_queue: the function filters (POSTED, not deleted,
 * pickup_end still in the future) and joins the category, donor and pickup address.
 * The order and the limit are applied here, on top of the function, because a LIMIT
 * without an outer ORDER BY would leave the rows the database returns unspecified.
 */
export const prismaDonationQueueStore: AdminDonationQueueStore = {
  async findPostedDonations(foodCategoryId, limit) {
    // Two bound parameters; the category is cast to smallint, null means "every category".
    const rows = await prisma.$queryRaw<QueueRow[]>`
      SELECT donation_id, food_name, category, portions, donor_name,
             donor_type::text AS donor_type, pickup_address,
             pickup_start, pickup_end, posted_at
      FROM fn_admin_donation_queue(${foodCategoryId}::smallint)
      ORDER BY pickup_end, posted_at, donation_id
      LIMIT ${limit}`;

    return rows.map((row) => ({
      donationId: row.donation_id,
      foodName: row.food_name,
      category: row.category,
      portions: row.portions,
      donorName: row.donor_name,
      donorType: donorTypeSchema.parse(row.donor_type),
      pickupAddress: row.pickup_address,
      pickupStart: row.pickup_start,
      pickupEnd: row.pickup_end,
      postedAt: row.posted_at,
    }));
  },
};
