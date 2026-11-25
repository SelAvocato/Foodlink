import { prisma } from "@/server/db";
import type { AdminDashboardStore } from "./dashboard";

type ScreeningCaseRow = { screening_id: string; donation_id: string; food_name: string; created_at: Date };

export const prismaAdminDashboardStore: AdminDashboardStore = {
  async countPendingRegistrations() {
    return prisma.users.count({
      where: {
        role: { in: ["DONOR", "VOLUNTEER"] },
        status: "PENDING",
        deleted_at: null,
      },
    });
  },

  async countScreeningReviews() {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT DISTINCT ON (fs.donation_id) fs.verdict, fs.reviewed_at, d.status, d.deleted_at
        FROM food_screenings fs
        JOIN donations d ON d.id = fs.donation_id
        ORDER BY fs.donation_id, fs.created_at DESC, fs.id DESC
      ) latest
      WHERE latest.verdict = 'REVIEW'
        AND latest.reviewed_at IS NULL
        AND latest.status = 'DRAFT'
        AND latest.deleted_at IS NULL`;
    return Number(rows[0]?.count ?? 0);
  },

  async countPostedDonations() {
    const rows = await prisma.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(*)::bigint AS count
      FROM fn_admin_donation_queue(NULL::smallint)`;
    return Number(rows[0]?.count ?? 0);
  },

  async countAcceptedAwaitingAssignment(now) {
    return prisma.donations.count({
      where: { status: "ACCEPTED", deleted_at: null, pickup_end: { gt: now } },
    });
  },

  async listRecentRegistrations(limit) {
    const rows = await prisma.users.findMany({
      where: {
        role: { in: ["DONOR", "VOLUNTEER"] },
        status: "PENDING",
        deleted_at: null,
      },
      orderBy: { created_at: "desc" },
      take: limit,
      select: { id: true, full_name: true, role: true, created_at: true },
    });
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      role: row.role as "DONOR" | "VOLUNTEER",
      createdAt: row.created_at,
    }));
  },

  async listRecentScreenings(limit) {
    const rows = await prisma.$queryRaw<ScreeningCaseRow[]>`
      SELECT fs.id AS screening_id, fs.donation_id, d.food_name, fs.created_at
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
      ORDER BY fs.created_at DESC, fs.id DESC
      LIMIT ${limit}`;
    return rows.map((row) => ({
      screeningId: row.screening_id,
      donationId: row.donation_id,
      foodName: row.food_name,
      createdAt: row.created_at,
    }));
  },

  async listRecentPostedDonations(limit) {
    const rows = await prisma.$queryRaw<Array<{
      donation_id: string;
      food_name: string;
      donor_name: string;
      posted_at: Date | null;
      pickup_end: Date | null;
    }>>`
      SELECT donation_id, food_name, donor_name, posted_at, pickup_end
      FROM fn_admin_donation_queue(NULL::smallint)
      ORDER BY posted_at DESC NULLS LAST, pickup_end ASC NULLS LAST, donation_id DESC
      LIMIT ${limit}`;
    return rows.map((row) => ({
      donationId: row.donation_id,
      foodName: row.food_name,
      donorName: row.donor_name,
      postedAt: row.posted_at,
      pickupEnd: row.pickup_end,
    }));
  },

  async listRecentAcceptedDonations(now, limit) {
    const rows = await prisma.donations.findMany({
      where: { status: "ACCEPTED", deleted_at: null, pickup_end: { gt: now } },
      orderBy: [{ pickup_end: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        food_name: true,
        pickup_end: true,
        users_donations_donor_idTousers: { select: { business_name: true, full_name: true } },
      },
    });
    return rows
      .filter((row): row is typeof row & { pickup_end: Date } => row.pickup_end instanceof Date)
      .map((row) => ({
        donationId: row.id,
        foodName: row.food_name,
        donorName:
          row.users_donations_donor_idTousers.business_name?.trim() ||
          row.users_donations_donor_idTousers.full_name,
        pickupEnd: row.pickup_end,
      }));
  },
};
