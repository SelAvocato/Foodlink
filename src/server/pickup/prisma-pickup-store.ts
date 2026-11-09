import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type { LockedPickupDonation, PickupStore, PickupTx, ReadPickupDonation, StoredPickup } from "./donation-pickup";

type LockRow = {
  donor_id: string;
  status: string;
  deleted_at: Date | null;
  pickup_address_id: string | null;
  consume_by_at: Date | null;
};

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in donation-pickup.ts. updated_at is set
// explicitly here (the set_updated_at trigger would do the same on UPDATE).
function createTransactionAdapter(tx: typeof prisma): PickupTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // LEFT JOIN: a donation without a checklist row still locks and reads fine.
      const rows = await tx.$queryRaw<LockRow[]>`
        SELECT d.donor_id,
               d.status::text AS status,
               d.deleted_at,
               d.pickup_address_id,
               cl.consume_by_at
        FROM donations d
        LEFT JOIN donation_safety_checklists cl ON cl.donation_id = d.id
        WHERE d.id = ${id}::uuid
        FOR UPDATE OF d`;
      const row = rows[0];
      if (!row) return null;
      if (!DONATION_STATUSES.includes(row.status)) {
        throw new Error(`Unknown donation status on getDonationLocked: ${row.status}`);
      }
      const locked: LockedPickupDonation = {
        donorId: row.donor_id,
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
        pickupAddressId: row.pickup_address_id,
        consumeByAt: row.consume_by_at,
      };
      return locked;
    },
    async insertAddress(row) {
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
    async setPickup(donationId, row) {
      await tx.donations.update({
        where: { id: donationId },
        data: {
          pickup_address_id: row.addressId,
          pickup_start: row.pickupStart,
          pickup_end: row.pickupEnd,
          updated_at: new Date(),
        },
      });
    },
    async deleteAddressIfUnshared(addressId) {
      // Every table that references addresses(id) (schema lines 120, 142, 288):
      // one guarded statement, so a shared row is kept without ever catching an
      // FK error. The donation already points at the new address, so the count
      // over donations only sees other pickups.
      await tx.$executeRaw`
        DELETE FROM addresses a
        WHERE a.id = ${addressId}::uuid
          AND NOT EXISTS (SELECT 1 FROM users u WHERE u.address_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM host_organization h WHERE h.address_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM donations d WHERE d.pickup_address_id = a.id)`;
    },
  };
}

export const prismaPickupStore: PickupStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
  async readDonation(id): Promise<ReadPickupDonation | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id, deleted_at: null },
      select: { donor_id: true },
    });
    if (!donation) return null;
    return { donorId: donation.donor_id };
  },
  async readPickup(donationId): Promise<StoredPickup | null> {
    if (!UUID_PATTERN.test(donationId)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id: donationId, deleted_at: null, pickup_address_id: { not: null } },
      select: {
        pickup_start: true,
        pickup_end: true,
        addresses: {
          select: {
            street_line1: true,
            street_line2: true,
            barangay: true,
            city: true,
            province_or_state: true,
            postal_code: true,
            country_code: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });
    // donations_pickup_all_or_none keeps the three columns together; without an
    // address there is no pickup to show.
    if (!donation || !donation.addresses || donation.pickup_start === null || donation.pickup_end === null) {
      return null;
    }
    const address = donation.addresses;
    return {
      address: {
        streetLine1: address.street_line1,
        streetLine2: address.street_line2,
        barangay: address.barangay,
        city: address.city,
        provinceOrState: address.province_or_state,
        postalCode: address.postal_code,
        countryCode: address.country_code,
        // numeric(9,6) arrives as a Decimal; the view speaks plain numbers or null.
        latitude: address.latitude === null ? null : Number(address.latitude),
        longitude: address.longitude === null ? null : Number(address.longitude),
      },
      pickupStart: donation.pickup_start,
      pickupEnd: donation.pickup_end,
    };
  },
};
