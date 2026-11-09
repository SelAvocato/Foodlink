import { screening_verdict } from "@/generated/prisma/enums";
import { ALLOWED_IMAGE_TYPES, type AllowedImageType } from "@/contracts/image";
import { prisma } from "@/server/db";
import type { ActiveFoodPhoto, ScreeningDonation, ScreeningStore } from "./screen-draft-photo";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toMimeType(value: string): AllowedImageType {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(value)) {
    throw new Error(`Unknown image mime type on findActiveFoodPhoto: ${value}`);
  }
  return value as AllowedImageType;
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
  async findActiveFoodPhoto(donationId): Promise<ActiveFoodPhoto | null> {
    if (!UUID_PATTERN.test(donationId)) return null;
    const photo = await prisma.donation_images.findFirst({
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
  },
  async hasPendingReview(donationId) {
    if (!UUID_PATTERN.test(donationId)) return false;
    const count = await prisma.food_screenings.count({
      where: {
        donation_id: donationId,
        verdict: screening_verdict.REVIEW,
        reviewed_at: null,
      },
    });
    return count > 0;
  },
  async insertScreening(row) {
    const screening = await prisma.food_screenings.create({
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
  },
};
