import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type {
  HandoverPhotoDonation,
  HandoverPhotoInsert,
  HandoverPhotoStore,
  HandoverPhotoTx,
} from "./handover-photo";

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

async function softDeleteActiveHandoverPhotoIn(db: Db, donationId: string): Promise<string[]> {
  if (!UUID_PATTERN.test(donationId)) return [];
  // There is no unique index on HANDOVER_PROOF, so every active row is retired;
  // the service serializes uploads on the donation lock, so normally there is one.
  const active = await db.donation_images.findMany({
    where: { donation_id: donationId, image_role: "HANDOVER_PROOF", deleted_at: null },
    select: { id: true, storage_key: true },
  });
  if (active.length === 0) return [];
  await db.donation_images.updateMany({
    where: { id: { in: active.map((row) => row.id) } },
    data: { deleted_at: new Date() },
  });
  return active.map((row) => row.storage_key);
}

async function insertHandoverPhotoIn(
  db: Db,
  row: HandoverPhotoInsert,
): Promise<{ id: string; createdAt: Date }> {
  return db.donation_images.create({
    data: {
      donation_id: row.donationId,
      uploaded_by_user_id: row.uploadedByUserId,
      storage_key: row.storageKey,
      image_role: "HANDOVER_PROOF",
      mime_type: row.mimeType,
      size_bytes: BigInt(row.sizeBytes),
    },
    select: { id: true, created_at: true },
  }).then((image) => ({ id: image.id, createdAt: image.created_at }));
}

function createTransactionAdapter(tx: Db): HandoverPhotoTx {
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
      const locked: HandoverPhotoDonation = {
        status: row.status as DonationStatus,
        deletedAt: row.deleted_at,
      };
      return locked;
    },
    findCurrentVolunteerId: (donationId) => findCurrentVolunteerIdIn(tx, donationId),
    softDeleteActiveHandoverPhoto: (donationId) =>
      softDeleteActiveHandoverPhotoIn(tx, donationId),
    insertHandoverPhoto: (row) => insertHandoverPhotoIn(tx, row),
  };
}

// Thin wiring only: the rules live in handover-photo.ts.
export const prismaHandoverPhotoStore: HandoverPhotoStore = {
  async readDonation(id): Promise<HandoverPhotoDonation | null> {
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
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as Db)));
  },
};
