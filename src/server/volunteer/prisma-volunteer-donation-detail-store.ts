import { z } from "zod";
import { VOLUNTEER_DONATION_STATUSES } from "@/contracts/volunteer-donation-list";
import { prisma } from "@/server/db";
import type {
  VolunteerDonationDetailRow,
  VolunteerDonationDetailStore,
} from "@/server/volunteer/donation-detail";

type DetailRow = {
  donation_id: string;
  food_name: string;
  category: string;
  portions: number;
  status: string;
  pickup_address: string | null;
  pickup_start: Date | null;
  pickup_end: Date | null;
  donor_name: string;
  donor_phone: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const donationStatusSchema = z.enum(VOLUNTEER_DONATION_STATUSES);

// Thin wiring only: the access rules live in donation-detail.ts.
export const prismaVolunteerDonationDetailStore: VolunteerDonationDetailStore = {
  async findTask({ volunteerId, donationId, statuses }): Promise<VolunteerDonationDetailRow | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such task".
    if (!UUID_PATTERN.test(donationId)) return null;

    const rows = await prisma.$queryRaw<DetailRow[]>`
      SELECT d.id AS donation_id,
             d.food_name,
             fc.name AS category,
             d.portions,
             d.status::text AS status,
             NULLIF(concat_ws(', ', a.street_line1, a.street_line2, a.barangay, a.city, a.province_or_state), '') AS pickup_address,
             d.pickup_start,
             d.pickup_end,
             COALESCE(du.business_name, du.full_name) AS donor_name,
             du.contact_number AS donor_phone
      FROM donations d
      JOIN donation_assignments da ON da.donation_id = d.id
      JOIN food_categories fc ON fc.id = d.food_category_id
      JOIN users du ON du.id = d.donor_id
      LEFT JOIN addresses a ON a.id = d.pickup_address_id
      WHERE da.volunteer_id = ${volunteerId}::uuid
        AND da.ended_at IS NULL
        AND d.deleted_at IS NULL
        AND d.id = ${donationId}::uuid
        AND d.status = ANY(${statuses}::donation_status[])
      LIMIT 1`;

    const row = rows[0];
    if (!row) return null;

    return {
      donationId: row.donation_id,
      foodName: row.food_name,
      category: row.category,
      portions: row.portions,
      status: donationStatusSchema.parse(row.status),
      pickupAddress: row.pickup_address,
      pickupStart: row.pickup_start,
      pickupEnd: row.pickup_end,
      donorName: row.donor_name,
      donorPhone: row.donor_phone,
    };
  },
};
