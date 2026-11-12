import { prisma } from "@/server/db";
import type { ScreeningDecisionRow, ScreeningDecisionStore } from "./decide-screening";

// Thin wiring only: the rules live in decide-screening.ts. Two plain reads and
// one conditional stamp; typed queries so the columns are checked at compile
// time.
export const prismaScreeningDecisionStore: ScreeningDecisionStore = {
  async findScreening(screeningId): Promise<ScreeningDecisionRow | null> {
    const row = await prisma.food_screenings.findUnique({
      where: { id: screeningId },
      select: {
        id: true,
        donation_id: true,
        verdict: true,
        reviewed_at: true,
        donations: { select: { status: true, deleted_at: true } },
      },
    });
    if (!row) return null;

    // The latest-screening rule (newest created_at, id as tiebreak — the same
    // rule the queue applies) cannot be correlated in Prisma's query builder,
    // so the donation's newest screening row is read separately.
    const newest = await prisma.food_screenings.findFirst({
      where: { donation_id: row.donation_id },
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    return {
      screeningId: row.id,
      donationId: row.donation_id,
      verdict: row.verdict,
      reviewedAt: row.reviewed_at,
      donationStatus: row.donations.status,
      deletedAt: row.donations.deleted_at,
      isLatestScreening: newest?.id === row.id,
    } satisfies ScreeningDecisionRow;
  },

  async stampReview(input): Promise<boolean> {
    // Conditional on reviewed_at IS NULL: a second reviewer cannot restamp,
    // and notes (the AI notes) are never written here. Exactly one row means
    // the stamp landed; zero means the screening was not pending after all.
    const result = await prisma.food_screenings.updateMany({
      where: { id: input.screeningId, reviewed_at: null },
      data: { reviewed_by_user_id: input.reviewerId, reviewed_at: input.reviewedAt },
    });
    return result.count === 1;
  },
};
