import { DonationStatus } from "@/contracts/enums";
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from "@/contracts/image";
import { prisma } from "@/server/db";
import { insertScreeningIn } from "@/server/screening/prisma-screening-store";
import type { DonorPhoto, DonorPhotoUrlStore } from "./donor-photo-url";
import type {
  PickupPhotoDonation,
  PickupPhotoInsert,
  PickupPhotoStore,
  PickupPhotoTx,
} from "./pickup-photo";

type Db = typeof prisma;
type LockRow = { status: string; deleted_at: Date | null };

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toMimeType(value: string): AllowedImageType {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown image mime type on findActiveFoodPhoto: ${value}`);
  }
  return value as AllowedImageType;
}

async function findCurrentVolunteerIdIn(db: Db, donationId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const rows = await db.$queryRaw<{ volunteer_id: string }[]>`
    SELECT volunteer_id
    FROM donation_assignments
    WHERE donation_id = ${donationId}::uuid AND ended_at IS NULL
    LIMIT 1`;
  return rows[0]?.volunteer_id ?? null;
}

async function hasPickupScanIn(
  db: Db,
  donationId: string,
  volunteerId: string,
): Promise<boolean> {
  if (!UUID_PATTERN.test(donationId)) return false;
  const count = await db.donation_qr_scans.count({
    where: {
      donation_id: donationId,
      stage: "PICKUP",
      scanned_by_user_id: volunteerId,
    },
  });
  return count > 0;
}

async function hasInspectionIn(db: Db, donationId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(donationId)) return false;
  const count = await db.donation_pickup_inspections.count({
    where: { donation_id: donationId },
  });
  return count > 0;
}

async function softDeleteActivePickupPhotoIn(db: Db, donationId: string): Promise<string[]> {
  if (!UUID_PATTERN.test(donationId)) return [];
  // There is no unique index on PICKUP_PHOTO, so every active row is retired;
  // the service serializes uploads on the donation lock, so normally there is one.
  const active = await db.donation_images.findMany({
    where: { donation_id: donationId, image_role: "PICKUP_PHOTO", deleted_at: null },
    select: { id: true, storage_key: true },
  });
  if (active.length === 0) return [];
  await db.donation_images.updateMany({
    where: { id: { in: active.map((row) => row.id) } },
    data: { deleted_at: new Date() },
  });
  return active.map((row) => row.storage_key);
}

async function insertPickupPhotoIn(
  db: Db,
  row: PickupPhotoInsert,
): Promise<{ id: string }> {
  const image = await db.donation_images.create({
    data: {
      donation_id: row.donationId,
      uploaded_by_user_id: row.uploadedByUserId,
      storage_key: row.storageKey,
      image_role: "PICKUP_PHOTO",
      mime_type: row.mimeType,
      size_bytes: BigInt(row.sizeBytes),
    },
    select: { id: true },
  });
  return { id: image.id };
}

async function findActiveFoodPhotoIn(db: Db, donationId: string): Promise<DonorPhoto | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const photo = await db.donation_images.findFirst({
    where: { donation_id: donationId, image_role: "FOOD_PHOTO", deleted_at: null },
    orderBy: { created_at: "desc" },
    select: { storage_key: true, mime_type: true },
  });
  if (!photo) return null;
  return { storageKey: photo.storage_key, mimeType: toMimeType(photo.mime_type) };
}

function createTransactionAdapter(tx: Db): PickupPhotoTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE OF d: the re-checks and the photo swap must not interleave with
      // a transition or a second upload.
      const rows = await tx.$queryRaw<LockRow[]>`
        SELECT d.status::text AS status, d.deleted_at
        FROM donations d
        WHERE d.id = ${id}::uuid
        FOR UPDATE OF d`;
      const row = rows[0];
      if (!row) return null;
      if (!DONATION_STATUSES.includes(row.status)) {
        throw new Error(`Unknown donation status on getDonationLocked: ${row.status}`);
      }
      const locked: PickupPhotoDonation = {
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
      };
      return locked;
    },
    findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(tx, donationId),
    hasPickupScan: (donationId, volunteerId) => hasPickupScanIn(tx, donationId, volunteerId),
    hasInspection: (donationId) => hasInspectionIn(tx, donationId),
    softDeleteActivePickupPhoto: (donationId) => softDeleteActivePickupPhotoIn(tx, donationId),
    insertPickupPhoto: (row) => insertPickupPhotoIn(tx, row),
    insertScreening: (row) => insertScreeningIn(tx, row),
  };
}

// Thin wiring only: the rules live in pickup-photo.ts and donor-photo-url.ts.
export const prismaPickupPhotoStore: PickupPhotoStore & DonorPhotoUrlStore = {
  async readDonation(id): Promise<PickupPhotoDonation | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { status: true, deleted_at: true },
    });
    if (!donation) return null;
    return { status: donation.status, deletedAt: donation.deleted_at };
  },
  findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(prisma, donationId),
  hasPickupScan: (donationId, volunteerId) =>
    hasPickupScanIn(prisma, donationId, volunteerId),
  hasInspection: (donationId) => hasInspectionIn(prisma, donationId),
  findActiveFoodPhoto: (donationId) => findActiveFoodPhotoIn(prisma, donationId),
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as Db)));
  },
};
