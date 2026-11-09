import type { AdminDonationQueueItem } from "@/contracts/admin-donation-queue";

export interface AdminDonationQueueStore {
  /**
   * POSTED, unexpired, non-deleted donations in fn_admin_donation_queue's order
   * (soonest pickup end, then posted_at), at most `limit` of them. A null category
   * means every category.
   */
  findPostedDonations(
    foodCategoryId: number | null,
    limit: number,
  ): Promise<AdminDonationQueueItem[]>;
}

export interface AdminDonationQueueInput {
  limit: number;
  foodCategoryId?: number;
}

/**
 * Admin-wide queue, so there is no ownership check here: the route has already
 * verified the Admin role. The database function is the rule for status, expiry,
 * deletion and order; the service only trims to the limit and shapes the response.
 */
export async function listAdminDonationQueue(
  deps: { store: AdminDonationQueueStore },
  input: AdminDonationQueueInput,
): Promise<AdminDonationQueueItem[]> {
  const rows = await deps.store.findPostedDonations(input.foodCategoryId ?? null, input.limit);

  // The store already limits, but slice again so a misbehaving store cannot widen the response.
  return rows.slice(0, input.limit).map((row) => ({
    donationId: row.donationId,
    foodName: row.foodName,
    category: row.category,
    portions: row.portions,
    donorName: row.donorName,
    donorType: row.donorType,
    // concat_ws returns "" when the joined address parts are all null.
    pickupAddress: row.pickupAddress === null || row.pickupAddress === "" ? null : row.pickupAddress,
    pickupStart: row.pickupStart,
    pickupEnd: row.pickupEnd,
    postedAt: row.postedAt,
  }));
}
