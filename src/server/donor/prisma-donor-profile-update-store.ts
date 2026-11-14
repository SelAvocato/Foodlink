import { writeAuditLog } from "@/server/audit";
import { prisma } from "@/server/db";
import type {
  CurrentAddress,
  NewAddressRow,
  ProfileUpdateStore,
  ProfileUpdateTx,
} from "./donor-profile-update";

type LockRow = {
  contact_number: string;
  address_id: string | null;
};

/** The addresses row of the second statement. street_line1, city and country_code
 * are NOT NULL in db/baseline/001_schema.sql, the rest are nullable columns. */
type AddressRow = {
  street_line1: string;
  street_line2: string | null;
  barangay: string | null;
  city: string;
  province_or_state: string | null;
  postal_code: string | null;
  country_code: string;
  latitude: number | null;
  longitude: number | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in donor-profile-update.ts. updated_at is set
// explicitly here (the set_updated_at trigger would do the same on UPDATE).
function createTransactionAdapter(tx: typeof prisma): ProfileUpdateTx {
  return {
    async getUserLocked(userId) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such user".
      if (!UUID_PATTERN.test(userId)) return null;
      // Two statements on purpose: in READ COMMITTED a locking query that had to wait
      // re-reads the locked users row but keeps this statement's old snapshot for a
      // joined table, so one join could return the NEW address_id without the NEW
      // address row. The second statement below takes a fresh snapshot instead.
      const rows = await tx.$queryRaw<LockRow[]>`
        SELECT u.contact_number, u.address_id
        FROM users u
        WHERE u.id = ${userId}::uuid AND u.role = 'DONOR' AND u.deleted_at IS NULL
        FOR UPDATE`;
      const row = rows[0];
      if (!row) return null;
      if (row.address_id === null) {
        return { contactNumber: row.contact_number, addressId: null, address: null };
      }

      const addressRows = await tx.$queryRaw<AddressRow[]>`
        SELECT street_line1, street_line2, barangay, city,
               province_or_state, postal_code, country_code,
               latitude::float8 AS latitude, longitude::float8 AS longitude
        FROM addresses
        WHERE id = ${row.address_id}::uuid`;
      const addressRow = addressRows[0];
      // addresses.id is referenced with ON DELETE RESTRICT, so the row cannot be gone
      // while users points at it: no row here is a bug, and throwing rolls the whole
      // transaction back instead of copying nulls into a new address row.
      if (!addressRow) throw new Error("The donor's address row is missing.");
      const address: CurrentAddress = {
        streetLine1: addressRow.street_line1,
        streetLine2: addressRow.street_line2,
        barangay: addressRow.barangay,
        city: addressRow.city,
        provinceOrState: addressRow.province_or_state,
        postalCode: addressRow.postal_code,
        countryCode: addressRow.country_code,
        // numeric(9,6) would come back from Prisma as a Decimal object.
        latitude: addressRow.latitude,
        longitude: addressRow.longitude,
      };
      return { contactNumber: row.contact_number, addressId: row.address_id, address };
    },
    async insertAddress(row: NewAddressRow) {
      const address = await tx.addresses.create({
        data: {
          street_line1: row.streetLine1,
          street_line2: row.streetLine2,
          barangay: row.barangay,
          city: row.city,
          province_or_state: row.provinceOrState,
          postal_code: row.postalCode,
          country_code: row.countryCode,
          latitude: row.latitude,
          longitude: row.longitude,
        },
        select: { id: true },
      });
      return { id: address.id };
    },
    async updateUser(userId, changes) {
      // undefined fields are left untouched: a contact-only save never writes address_id.
      await tx.users.update({
        where: { id: userId },
        data: {
          contact_number: changes.contactNumber,
          address_id: changes.addressId,
          updated_at: new Date(),
        },
      });
    },
    async deleteAddressIfUnshared(addressId) {
      // Every table that references addresses(id) (schema lines 120, 142, 288): one
      // guarded statement, so a shared row is kept without ever catching an FK error.
      // The user already points at the new address, so the count over users only sees
      // other users. Same three-table check as prisma-pickup-store.ts
      // deleteAddressIfUnshared: a NEW table that references addresses must be added
      // in BOTH stores.
      await tx.$executeRaw`
        DELETE FROM addresses a
        WHERE a.id = ${addressId}::uuid
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.address_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM host_organization h WHERE h.address_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM donations d WHERE d.pickup_address_id = a.id)`;
    },
    async insertAudit(input) {
      // Field names only: the number, the address text and the pin never reach the log.
      await writeAuditLog(
        {
          actorUserId: input.actorUserId,
          action: "profile_updated",
          targetType: "user",
          targetId: input.actorUserId,
          details: { changed: [...input.changed].join(",") },
        },
        tx,
      );
    },
  };
}

export const prismaDonorProfileUpdateStore: ProfileUpdateStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
};
