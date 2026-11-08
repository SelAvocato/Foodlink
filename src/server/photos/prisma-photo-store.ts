import { DonationStatus } from "@/contracts/enums";
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from "@/contracts/image";
import { prisma } from "@/server/db";
import type { PhotoDonation, PhotoStore, PhotoTx } from "./donation-photo";

type LockRow = { donor_id: string; status: string; deleted_at: Date | null };

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Thin wiring only: the rules live in donation-photo.ts.
function createTransactionAdapter(tx: typeof prisma): PhotoTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE OF d: a retake must not race a status change or a second upload.
      const rows = await tx.$queryRaw<LockRow[]>`
        SELECT d.donor_id, d.status::text AS status, d.deleted_at
        FROM donations d
        WHERE d.id = ${id}::uuid
        FOR UPDATE OF d`;
      const row = rows[0];
      if (!row) return null;
      if (!DONATION_STATUSES.includes(row.status)) {
        throw new Error(`Unknown donation status on getDonationLocked: ${row.status}`);
      }
      const locked: PhotoDonation = {
        donorId: row.donor_id,
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
      };
      return locked;
    },
    async softDeleteActiveFoodPhoto(donationId) {
      await tx.donation_images.updateMany({
        where: { donation_id: donationId, image_role: "FOOD_PHOTO", deleted_at: null },
        data: { deleted_at: new Date() },
      });
    },
    async insertFoodPhoto(row) {
      return tx.donation_images.create({
        data: {
          donation_id: row.donationId,
          uploaded_by_user_id: row.uploadedByUserId,
          storage_key: row.storageKey,
          image_role: "FOOD_PHOTO",
          mime_type: row.mimeType,
          size_bytes: BigInt(row.sizeBytes),
        },
        select: { id: true },
      });
    },
  };
}

function toMimeType(value: string): AllowedImageType {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown image mime type on findActiveFoodPhoto: ${value}`);
  }
  return value as AllowedImageType;
}

export const prismaPhotoStore: PhotoStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
  async readDonation(id): Promise<PhotoDonation | null> {
    if (!UUID_PATTERN.test(id)) return null;
    // deleted_at is selected so the service re-checks soft deletion on its side.
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { donor_id: true, status: true, deleted_at: true },
    });
    if (!donation) return null;
    return {
      donorId: donation.donor_id,
      status: donation.status,
      deletedAt: donation.deleted_at,
    };
  },
  async findActiveFoodPhoto(donationId) {
    if (!UUID_PATTERN.test(donationId)) return null;
    const photo = await prisma.donation_images.findFirst({
      where: { donation_id: donationId, image_role: "FOOD_PHOTO", deleted_at: null },
      orderBy: { created_at: "desc" },
      select: { storage_key: true, mime_type: true },
    });
    if (!photo) return null;
    return { storageKey: photo.storage_key, mimeType: toMimeType(photo.mime_type) };
  },
};
