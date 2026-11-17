import { pickup_decision } from "@/generated/prisma/enums";
import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type {
  InspectionDonation,
  InspectionScreening,
  InspectionUpsert,
  PickupInspectionStore,
  PickupInspectionTx,
  PickupPhotoRef,
} from "./pickup-inspection";

type Db = typeof prisma;
type LockRow = { status: string; deleted_at: Date | null };

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function findActivePickupPhotoIn(
  db: Db,
  donationId: string,
): Promise<PickupPhotoRef | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const photo = await db.donation_images.findFirst({
    where: { donation_id: donationId, image_role: "PICKUP_PHOTO", deleted_at: null },
    orderBy: { created_at: "desc" },
    select: { id: true },
  });
  return photo ? { imageId: photo.id } : null;
}

async function findLatestScreeningIn(
  db: Db,
  imageId: string,
): Promise<InspectionScreening | null> {
  if (!UUID_PATTERN.test(imageId)) return null;
  const screening = await db.food_screenings.findFirst({
    where: { image_id: imageId },
    orderBy: { created_at: "desc" },
    select: { id: true, verdict: true },
  });
  return screening ? { screeningId: screening.id, verdict: screening.verdict } : null;
}

async function upsertInspectionIn(db: Db, row: InspectionUpsert): Promise<void> {
  const data = {
    volunteer_id: row.volunteerId,
    photo_image_id: row.photoImageId,
    screening_id: row.screeningId,
    matches_description: row.matchesDescription,
    packaging_sealed_clean: row.packagingSealedClean,
    looks_smells_normal: row.looksSmellsNormal,
    decision: pickup_decision[row.decision],
    reason: row.reason,
    inspected_at: row.inspectedAt,
  };
  // One row per donation: a re-save replaces the previous answers.
  await db.donation_pickup_inspections.upsert({
    where: { donation_id: row.donationId },
    create: { donation_id: row.donationId, ...data },
    update: data,
  });
}

function createTransactionAdapter(tx: Db): PickupInspectionTx {
  return {
    async getDonationLocked(id) {
      // A malformed id would make the ::uuid cast throw; treat it as "no such donation".
      if (!UUID_PATTERN.test(id)) return null;
      // FOR UPDATE OF d: the re-checks and the upsert must not interleave with a
      // transition or a photo retake.
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
      const locked: InspectionDonation = {
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
      };
      return locked;
    },
    findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(tx, donationId),
    hasPickupScan: (donationId, volunteerId) => hasPickupScanIn(tx, donationId, volunteerId),
    findActivePickupPhoto: (donationId) => findActivePickupPhotoIn(tx, donationId),
    findLatestScreening: (imageId) => findLatestScreeningIn(tx, imageId),
    upsertInspection: (row) => upsertInspectionIn(tx, row),
  };
}

// Thin wiring only: the rules live in pickup-inspection.ts.
export const prismaPickupInspectionStore: PickupInspectionStore = {
  async readDonation(id): Promise<InspectionDonation | null> {
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
  findActivePickupPhoto: (donationId) => findActivePickupPhotoIn(prisma, donationId),
  findLatestScreening: (imageId) => findLatestScreeningIn(prisma, imageId),
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as Db)));
  },
};
