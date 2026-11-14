import { z } from "zod";
import { DONOR_DONATION_TAB_STATUSES } from "@/contracts/donor-donation-list";
import { DonationStatus } from "@/contracts/enums";
import type { DonorDonationListStore } from "@/server/donor/donation-list";
import { prisma } from "@/server/db";

type PageRow = {
  donation_id: string;
  food_name: string;
  category: string;
  portions: number;
  status: string;
  pickup_start: Date | null;
  pickup_end: Date | null;
  updated_at: Date;
  checklist_complete: boolean;
};

type TotalRow = { total: number };

type CountsRow = {
  drafts: number;
  active: number;
  completed: number;
  not_completed: number;
};

const donationStatusSchema = z.enum(DonationStatus);

/**
 * Thin adapter over the donations tables. Every value is a bound parameter, so a
 * search string can never become SQL. The donor id narrows the result to the
 * donor's own non-deleted donations; no donor, address, QR token or exit data is
 * ever selected. The search is prefix-only on the id plus a case-insensitive
 * substring on the food name, with no LIKE, so there is no wildcard to escape.
 * The page and the total are two statements, not one transaction: a donation can
 * change between them, so the total can differ from what the page would suggest.
 */
export const prismaDonationListStore: DonorDonationListStore = {
  async findPage({ donorId, statuses, q, limit, offset }) {
    const search = q ?? null;

    // Bound: donor id, the status list, the search (possibly null), limit, offset.
    const rows = await prisma.$queryRaw<PageRow[]>`
      SELECT d.id AS donation_id,
             d.food_name,
             fc.name AS category,
             d.portions,
             d.status::text AS status,
             d.pickup_start,
             d.pickup_end,
             d.updated_at,
             (c.completed_at IS NOT NULL) AS checklist_complete
      FROM donations d
      JOIN food_categories fc ON fc.id = d.food_category_id
      LEFT JOIN donation_safety_checklists c ON c.donation_id = d.id
      WHERE d.donor_id = ${donorId}::uuid
        AND d.deleted_at IS NULL
        AND d.status = ANY(${statuses}::donation_status[])
        AND (
          ${search}::text IS NULL
          OR starts_with(d.id::text, lower(${search}::text))
          OR position(lower(${search}::text) in lower(d.food_name)) > 0
        )
      ORDER BY d.updated_at DESC, d.id
      LIMIT ${limit}
      OFFSET ${offset}`;

    // The same WHERE, so the total describes every page of this filter.
    const totals = await prisma.$queryRaw<TotalRow[]>`
      SELECT count(*)::int AS total
      FROM donations d
      WHERE d.donor_id = ${donorId}::uuid
        AND d.deleted_at IS NULL
        AND d.status = ANY(${statuses}::donation_status[])
        AND (
          ${search}::text IS NULL
          OR starts_with(d.id::text, lower(${search}::text))
          OR position(lower(${search}::text) in lower(d.food_name)) > 0
        )`;

    return {
      rows: rows.map((row) => ({
        donationId: row.donation_id,
        foodName: row.food_name,
        category: row.category,
        portions: row.portions,
        status: donationStatusSchema.parse(row.status),
        pickupStart: row.pickup_start,
        pickupEnd: row.pickup_end,
        updatedAt: row.updated_at,
        checklistComplete: row.checklist_complete,
      })),
      total: totals[0]?.total ?? 0,
    };
  },

  async countByTab(donorId) {
    // One scan of the donor's non-deleted donations; every count is cast to int,
    // because Prisma would return count(*) as a BigInt otherwise.
    const rows = await prisma.$queryRaw<CountsRow[]>`
      SELECT count(*) FILTER (WHERE d.status = ANY(${DONOR_DONATION_TAB_STATUSES.drafts}::donation_status[]))::int AS drafts,
             count(*) FILTER (WHERE d.status = ANY(${DONOR_DONATION_TAB_STATUSES.active}::donation_status[]))::int AS active,
             count(*) FILTER (WHERE d.status = ANY(${DONOR_DONATION_TAB_STATUSES.completed}::donation_status[]))::int AS completed,
             count(*) FILTER (WHERE d.status = ANY(${DONOR_DONATION_TAB_STATUSES.not_completed}::donation_status[]))::int AS not_completed
      FROM donations d
      WHERE d.donor_id = ${donorId}::uuid
        AND d.deleted_at IS NULL`;

    const row = rows[0];
    return {
      drafts: row?.drafts ?? 0,
      active: row?.active ?? 0,
      completed: row?.completed ?? 0,
      notCompleted: row?.not_completed ?? 0,
    };
  },
};
