import type { DonorProfileStore } from "@/server/donor/donor-profile";
import { prisma } from "@/server/db";

/**
 * Thin adapter: one statement, one bound parameter. The role and the soft-delete
 * filter are literals in the SQL, so a row can only come back for a live Donor. The
 * address join is an inner join (Donors always have one, users_donor_volunteer_need_address),
 * and the document join is a LEFT JOIN LATERAL over the newest non-deleted row, so the
 * proof columns are both null when there is no document. latitude and longitude are cast
 * to float8 on purpose: numeric(9,6) would come back from Prisma as a Decimal object.
 * The projection never names storage_key, original_filename, review_note, the reviewer
 * or the file's metadata, so they cannot reach the service at all.
 */
export const prismaDonorProfileStore: DonorProfileStore = {
  async findProfile(userId) {
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT u.full_name, u.business_name, u.donor_type::text AS donor_type, u.email,
             u.status::text AS status, u.contact_number,
             a.street_line1, a.street_line2, a.barangay, a.city,
             a.latitude::float8 AS latitude, a.longitude::float8 AS longitude,
             d.type_name AS proof_type_name, d.status AS proof_status
      FROM users u
      JOIN addresses a ON a.id = u.address_id
      LEFT JOIN LATERAL (
        SELECT dt.name AS type_name, ud.status::text AS status
        FROM user_documents ud
        JOIN document_types dt ON dt.id = ud.document_type_id
        WHERE ud.user_id = u.id AND ud.deleted_at IS NULL
        ORDER BY ud.created_at DESC
        LIMIT 1
      ) d ON true
      WHERE u.id = ${userId}::uuid AND u.role = 'DONOR' AND u.deleted_at IS NULL`;

    return rows[0] ?? null;
  },
};
