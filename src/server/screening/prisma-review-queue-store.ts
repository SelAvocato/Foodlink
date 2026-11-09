import { prisma } from "@/server/db";
import type { ReviewQueueRow, ReviewQueueStore } from "./review-queue";

type PendingCaseRow = { donation_id: string; id: string };

// Thin wiring only: the rules live in review-queue.ts. Three plain reads:
// which donations are pending, their screening rows, and the active photo keys.
export const prismaReviewQueueStore: ReviewQueueStore = {
  async listPending(limit): Promise<ReviewQueueRow[]> {
    // The latest-screening rule cannot be correlated in Prisma's query builder,
    // so the pending case ids are selected here with DISTINCT ON (the same raw
    // read style as the other stores' ::uuid lock queries): only uuid columns
    // come back, everything below is a typed findMany.
    const cases = await prisma.$queryRaw<PendingCaseRow[]>`
      SELECT fs.donation_id, fs.id
      FROM (
        SELECT DISTINCT ON (donation_id) id, donation_id, created_at, verdict, reviewed_at
        FROM food_screenings
        ORDER BY donation_id, created_at DESC, id DESC
      ) fs
      JOIN donations d ON d.id = fs.donation_id
      WHERE fs.verdict = 'REVIEW'
        AND fs.reviewed_at IS NULL
        AND d.status = 'DRAFT'
        AND d.deleted_at IS NULL
      ORDER BY fs.created_at ASC, fs.id ASC
      LIMIT ${limit}`;
    if (cases.length === 0) return [];

    const screeningIds = cases.map((row) => row.id);
    const donationIds = cases.map((row) => row.donation_id);
    const [screenings, photos] = await Promise.all([
      prisma.food_screenings.findMany({
        where: { id: { in: screeningIds } },
        select: {
          id: true,
          donation_id: true,
          verdict: true,
          confidence: true,
          signs: true,
          notes: true,
          created_at: true,
          reviewed_at: true,
          donations: {
            select: {
              status: true,
              deleted_at: true,
              food_name: true,
              portions: true,
              food_categories: { select: { code: true } },
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
          },
        },
      }),
      // The one-to-one donation_images relation is never navigated (it would pick
      // an arbitrary row when soft-deleted retakes exist): the active photo is
      // counted by the partial unique index, so at most one row comes back.
      prisma.donation_images.findMany({
        where: { donation_id: { in: donationIds }, image_role: "FOOD_PHOTO", deleted_at: null },
        select: { donation_id: true, storage_key: true },
      }),
    ]);

    const photoKeyByDonation = new Map(photos.map((photo) => [photo.donation_id, photo.storage_key]));

    // Keep the case order the raw query produced (oldest first).
    const position = new Map(cases.map((row, index) => [row.id, index]));
    screenings.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));

    return screenings.map((row) => {
      const checklist = row.donations.donation_safety_checklists;
      const photoKey = photoKeyByDonation.get(row.donation_id) ?? null;
      return {
        screeningId: row.id,
        donationId: row.donation_id,
        verdict: row.verdict,
        reviewedAt: row.reviewed_at,
        createdAt: row.created_at,
        // numeric(5,4): the contract speaks plain numbers.
        confidence: row.confidence === null ? null : Number(row.confidence),
        signs: Array.isArray(row.signs)
          ? row.signs.filter((value): value is string => typeof value === "string")
          : [],
        notes: row.notes,
        donationStatus: row.donations.status,
        deletedAt: row.donations.deleted_at,
        foodName: row.donations.food_name,
        portions: row.donations.portions,
        categoryCode: row.donations.food_categories.code,
        checklist: checklist
          ? {
              preparedAt: checklist.prepared_at,
              consumeByAt: checklist.consume_by_at,
              storageCondition: checklist.storage_condition,
              // numeric(5,2) arrives as a Decimal; the contract speaks plain numbers.
              storageTemperatureC:
                checklist.storage_temperature_c === null
                  ? null
                  : Number(checklist.storage_temperature_c),
              packagingIntact: checklist.packaging_intact,
              allergensConfirmed: checklist.allergens_confirmed,
              notCustomerPlateLeftovers: checklist.not_customer_plate_leftovers,
              completedAt: checklist.completed_at,
            }
          : null,
        photoKey,
      } satisfies ReviewQueueRow;
    });
  },
};
