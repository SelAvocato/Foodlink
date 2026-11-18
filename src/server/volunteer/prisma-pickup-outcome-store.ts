import { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type {
  PickupOutcomeDonation,
  PickupOutcomeScreening,
  PickupOutcomeStore,
  StoredPickupInspection,
} from "./pickup-outcome";

const DONATION_STATUSES: readonly string[] = Object.values(DonationStatus);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findCurrentVolunteerId(donationId: string): Promise<string | null> {
  if (!UUID_PATTERN.test(donationId)) return null;
  const rows = await prisma.$queryRaw<{ volunteer_id: string }[]>`
    SELECT volunteer_id
    FROM donation_assignments
    WHERE donation_id = ${donationId}::uuid AND ended_at IS NULL
    LIMIT 1`;
  return rows[0]?.volunteer_id ?? null;
}

// Thin wiring only: the rules live in pickup-outcome.ts.
export const prismaPickupOutcomeStore: PickupOutcomeStore = {
  async readDonation(id): Promise<PickupOutcomeDonation | null> {
    // A malformed id would make the read throw; treat it as "no such donation".
    if (!UUID_PATTERN.test(id)) return null;
    const donation = await prisma.donations.findFirst({
      where: { id },
      select: { status: true, deleted_at: true },
    });
    if (!donation) return null;
    // The generated enum is text in GQL/raw reads; an unknown value must not
    // silently become a guessable status.
    if (!DONATION_STATUSES.includes(donation.status)) {
      throw new Error(`Unknown donation status on readDonation: ${donation.status}`);
    }
    return { status: donation.status, deletedAt: donation.deleted_at };
  },
  findCurrentVolunteerId,
  async findInspection(donationId): Promise<StoredPickupInspection | null> {
    if (!UUID_PATTERN.test(donationId)) return null;
    const row = await prisma.donation_pickup_inspections.findUnique({
      where: { donation_id: donationId },
      select: {
        volunteer_id: true,
        decision: true,
        reason: true,
        screening_id: true,
      },
    });
    return row
      ? {
          volunteerId: row.volunteer_id,
          decision: row.decision,
          reason: row.reason,
          screeningId: row.screening_id,
        }
      : null;
  },
  async findScreening(screeningId): Promise<PickupOutcomeScreening | null> {
    if (!UUID_PATTERN.test(screeningId)) return null;
    const row = await prisma.food_screenings.findUnique({
      where: { id: screeningId },
      select: { verdict: true },
    });
    return row ? { verdict: row.verdict } : null;
  },
};
