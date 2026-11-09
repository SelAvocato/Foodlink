import { screening_verdict } from "@/generated/prisma/enums";
import { DonationStatus } from "@/contracts/enums";
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from "@/contracts/image";
import { prisma } from "@/server/db";
import type {
  ActiveFoodPhoto,
  ScreeningDonation,
  ScreeningInsert,
  ScreeningStore,
  ScreeningTx,
} from "./screen-draft-photo";

type Db = typeof prisma;
type LockRow = { donor_id: string; status: string; deleted_at: Date | null };

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toMimeType(value: string): AllowedImageType {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown image mime type on findActiveFoodPhoto: ${value}`);
  }
  return value as AllowedImageType;
}

// Shared queries: the plain reads and the locked transaction run the same code.
async function findActiveFoodPhotoIn(db: Db, donationId: string): Promise<ActiveFoodPhoto | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const photo = await db.donation_images.findFirst({
    where: { donation_id: donationId, image_role: "FOOD_PHOTO", deleted_at: null },
    orderBy: { created_at: "desc" },
    select: { id: true, storage_key: true, mime_type: true },
  });
  if (!photo) return null;
  return {
    imageId: photo.id,
    storageKey: photo.storage_key,
    mimeType: toMimeType(photo.mime_type),
  };
}

async function hasPendingReviewIn(db: Db, donationId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(donationId)) return false;
  const count = await db.food_screenings.count({
    where: { donation_id: donationId, verdict: screening_verdict.REVIEW, reviewed_at: null },
  });
  return count > 0;
}

async function insertScreeningIn(db: Db, row: ScreeningInsert): Promise<{ id: string }> {
  const screening = await db.food_screenings.create({
    data: {
      donation_id: row.donationId,
      image_id: row.imageId,
      provider: row.provider,
      model_version: row.modelVersion,
      verdict: screening_verdict[row.verdict],
      // numeric(5,4): Prisma accepts the plain number and the column keeps four decimals.
      confidence: row.confidence,
      signs: row.signs,
      notes: row.notes,
    },
    select: { id: true },
  });
  return { id: screening.id };
}

function createTransactionAdapter(tx: Db): ScreeningTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE OF d: the final checks and the insert must not interleave with a retake.
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
      const locked: ScreeningDonation = {
        donorId: row.donor_id,
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
      };
      return locked;
    },
    findActiveFoodPhoto: (donationId) => findActiveFoodPhotoIn(tx, donationId),
    hasPendingReview: (donationId) => hasPendingReviewIn(tx, donationId),
    insertScreening: (row) => insertScreeningIn(tx, row),
  };
}

// Thin wiring only: the rules live in screen-draft-photo.ts.
export const prismaScreeningStore: ScreeningStore = {
  async readDonation(id): Promise<ScreeningDonation | null> {
    // A malformed id would make the uuid comparison throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
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
  findActiveFoodPhoto: (donationId) => findActiveFoodPhotoIn(prisma, donationId),
  hasPendingReview: (donationId) => hasPendingReviewIn(prisma, donationId),
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as Db)));
  },
};
