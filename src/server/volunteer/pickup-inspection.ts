import { DonationStatus, PickupDecision, type ScreeningVerdict } from "@/contracts/enums";
import {
  derivePickupDecision,
  screeningBlocksPickupAcceptance,
  type PickupInspectionInput,
} from "@/contracts/volunteer-pickup-inspection";

/** The donation facts an inspection needs. */
export type InspectionDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

/** The active PICKUP_PHOTO's id; the storage key is not needed here. */
export type PickupPhotoRef = {
  imageId: string;
};

/** The newest screening row on the active PICKUP_PHOTO. */
export type InspectionScreening = {
  screeningId: string;
  verdict: ScreeningVerdict;
};

export type InspectionUpsert = {
  donationId: string;
  volunteerId: string;
  photoImageId: string;
  screeningId: string;
  matchesDescription: boolean;
  packagingSealedClean: boolean;
  looksSmellsNormal: boolean;
  decision: PickupDecision;
  reason: string | null;
  inspectedAt: Date;
};

/**
 * The locked part of the store. The donation row is held FOR UPDATE, so the
 * re-checks and the upsert cannot interleave with a transition or a photo retake.
 */
export type PickupInspectionTx = {
  getDonationLocked(id: string): Promise<InspectionDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  /** The volunteer's own PICKUP scan; another volunteer's scan does not count. */
  hasPickupScan(donationId: string, volunteerId: string): Promise<boolean>;
  findActivePickupPhoto(donationId: string): Promise<PickupPhotoRef | null>;
  findLatestScreening(imageId: string): Promise<InspectionScreening | null>;
  /** One row per donation (PK donation_id): a re-save replaces it. */
  upsertInspection(row: InspectionUpsert): Promise<void>;
};

export interface PickupInspectionStore {
  readDonation(id: string): Promise<InspectionDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  hasPickupScan(donationId: string, volunteerId: string): Promise<boolean>;
  findActivePickupPhoto(donationId: string): Promise<PickupPhotoRef | null>;
  findLatestScreening(imageId: string): Promise<InspectionScreening | null>;
  /** Runs `work` atomically with the donation locked; rolls back if `work` throws. */
  transaction<T>(work: (tx: PickupInspectionTx) => Promise<T>): Promise<T>;
}

export type PickupInspectionError =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "SCAN_REQUIRED"
  | "PHOTO_REQUIRED"
  | "SCREENING_BLOCKED";

export type SavePickupInspectionResult =
  | { ok: true; decision: PickupDecision; inspectedAt: Date }
  | { ok: false; error: PickupInspectionError };

/**
 * Saves the volunteer's three answers as the pickup inspection, before the C7
 * transition reads it. The decision is derived from the answers here, never
 * taken from the client. A FLAG screening blocks an ACCEPTED decision, but a
 * REJECTED one needs no screening clearance: the volunteer is refusing anyway.
 * The row is upserted, so the volunteer may correct the answers while the
 * donation is still ASSIGNED; donations.status is never written here.
 */
export async function savePickupInspection(
  deps: { store: PickupInspectionStore; now?: () => Date },
  args: { volunteerId: string; donationId: string; input: PickupInspectionInput },
): Promise<SavePickupInspectionResult> {
  const { volunteerId, donationId, input } = args;
  const now = deps.now ?? (() => new Date());
  const decision = derivePickupDecision(input);

  // A plain read first: an unknown, foreign or finished donation must not be written.
  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // Assignment before the status: a volunteer who is not on this donation must
  // not learn its state from the error.
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "INVALID_STATE" };
  }
  if (!(await deps.store.hasPickupScan(donationId, volunteerId))) {
    return { ok: false, error: "SCAN_REQUIRED" };
  }
  const photo = await deps.store.findActivePickupPhoto(donationId);
  if (!photo) return { ok: false, error: "PHOTO_REQUIRED" };
  const screening = await deps.store.findLatestScreening(photo.imageId);
  // The upload always screens in the same transaction, so a photo without a
  // screening is inconsistent: ask for the photo again instead of guessing.
  if (!screening) return { ok: false, error: "PHOTO_REQUIRED" };
  if (decision === PickupDecision.ACCEPTED && screeningBlocksPickupAcceptance(screening.verdict)) {
    return { ok: false, error: "SCREENING_BLOCKED" };
  }

  const inspectedAt = now();

  return deps.store.transaction(async (tx): Promise<SavePickupInspectionResult> => {
    // Re-check under the lock: the donation or the photo may have changed since the read.
    const locked = await tx.getDonationLocked(donationId);
    if (!locked || locked.deletedAt !== null) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if ((await tx.findCurrentVolunteerId(donationId)) !== volunteerId) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (locked.status !== DonationStatus.ASSIGNED) {
      return { ok: false, error: "INVALID_STATE" };
    }
    if (!(await tx.hasPickupScan(donationId, volunteerId))) {
      return { ok: false, error: "SCAN_REQUIRED" };
    }
    const latestPhoto = await tx.findActivePickupPhoto(donationId);
    if (!latestPhoto) return { ok: false, error: "PHOTO_REQUIRED" };
    const latestScreening = await tx.findLatestScreening(latestPhoto.imageId);
    if (!latestScreening) return { ok: false, error: "PHOTO_REQUIRED" };
    if (
      decision === PickupDecision.ACCEPTED &&
      screeningBlocksPickupAcceptance(latestScreening.verdict)
    ) {
      return { ok: false, error: "SCREENING_BLOCKED" };
    }

    await tx.upsertInspection({
      donationId,
      volunteerId,
      photoImageId: latestPhoto.imageId,
      screeningId: latestScreening.screeningId,
      matchesDescription: input.matchesDescription,
      packagingSealedClean: input.packagingSealedClean,
      looksSmellsNormal: input.looksSmellsNormal,
      decision,
      // The contract only allows a reason on a no answer.
      reason: input.reason ?? null,
      inspectedAt,
    });

    return { ok: true, decision, inspectedAt };
  });
}
