import { prisma } from "@/server/db";
import type { PostingDonation, PostingStore } from "./post-donation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in post-donation.ts. Two plain reads: the
// donation row (with its checklist and category flags) and the active photo
// count; donations.donation_images is a one-to-one relation on the partial
// unique index, so the photo is counted directly with the same where clause
// the photo and screening stores use.
export const prismaPostingStore: PostingStore = {
  async readForPosting(id): Promise<PostingDonation | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      // Deleted rows are returned: the service decides what deleted_at means.
      where: { id },
      select: {
        donor_id: true,
        status: true,
        deleted_at: true,
        pickup_address_id: true,
        pickup_start: true,
        pickup_end: true,
        food_categories: { select: { requires_prepared_time: true, requires_storage_info: true } },
        donation_safety_checklists: {
          select: {
            prepared_at: true,
            consume_by_at: true,
            storage_condition: true,
            storage_temperature_c: true,
            packaging_intact: true,
            allergens_confirmed: true,
            not_customer_plate_leftovers: true,
            completed_at: true,
          },
        },
      },
    });
    if (!donation) return null;
    const photoCount = await prisma.donation_images.count({
      where: { donation_id: id, image_role: "FOOD_PHOTO", deleted_at: null },
    });
    const checklist = donation.donation_safety_checklists;
    return {
      donorId: donation.donor_id,
      status: donation.status,
      deletedAt: donation.deleted_at,
      pickupAddressId: donation.pickup_address_id,
      pickupStart: donation.pickup_start,
      pickupEnd: donation.pickup_end,
      requiresPreparedTime: donation.food_categories.requires_prepared_time,
      requiresStorageInfo: donation.food_categories.requires_storage_info,
      checklist: checklist
        ? {
            preparedAt: checklist.prepared_at,
            consumeByAt: checklist.consume_by_at,
            storageCondition: checklist.storage_condition,
            // numeric(5,2) arrives as a Decimal; the contract speaks plain numbers.
            storageTemperatureC:
              checklist.storage_temperature_c === null ? null : Number(checklist.storage_temperature_c),
            packagingIntact: checklist.packaging_intact,
            allergensConfirmed: checklist.allergens_confirmed,
            notCustomerPlateLeftovers: checklist.not_customer_plate_leftovers,
            completedAt: checklist.completed_at,
          }
        : null,
      hasActiveFoodPhoto: photoCount > 0,
    };
  },
};
