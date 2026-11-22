import {
  DonationTransitionError,
  createPrismaTransitionTx,
  transitionDonation,
} from "@/server/donations/transition-donation";
import { prisma } from "@/server/db";
import { runAchievementEngine } from "./achievement-engine";
import {
  prismaDistributionEntryStore,
} from "./prisma-distribution-entry-store";
import { createPrismaAchievementStore } from "./prisma-achievement-store";
import type {
  DistributionCompletionStore,
  DistributionCompletionTotals,
  DistributionCompletionTransition,
} from "./distribution-completion";
import type { TransitionStore } from "@/contracts/donation";

type TotalsRow = {
  entries: bigint | number;
  distributed: bigint | number;
  unusable: bigint | number;
};

type LockRow = {
  donor_id: string;
  volunteer_id: string | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const prismaDistributionCompletionStore: DistributionCompletionStore = {
  readDonation: (id) => prismaDistributionEntryStore.readDonation(id),
  findCurrentVolunteerId: (donationId) =>
    prismaDistributionEntryStore.findCurrentVolunteerId(donationId),
  async getCompletionTotals(donationId): Promise<DistributionCompletionTotals> {
    if (!UUID_PATTERN.test(donationId)) {
      return { entries: 0, distributed: 0, unusable: 0 };
    }
    const rows = await prisma.$queryRaw<TotalsRow[]>`
      SELECT
        (SELECT count(*) FROM distribution_entries WHERE donation_id = ${donationId}::uuid) AS entries,
        COALESCE((SELECT sum(portions_distributed) FROM distribution_entries WHERE donation_id = ${donationId}::uuid), 0) AS distributed,
        COALESCE((SELECT sum(portions) FROM unusable_portions WHERE donation_id = ${donationId}::uuid), 0) AS unusable`;
    const row = rows[0];
    return {
      entries: Number(row?.entries ?? 0),
      distributed: Number(row?.distributed ?? 0),
      unusable: Number(row?.unusable ?? 0),
    };
  },
};

function createLockedTransitionStore(
  donationId: string,
  state: { closedAt: Date | null },
): TransitionStore {
  return {
    transaction(work) {
      return prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<LockRow[]>`
            SELECT d.donor_id,
                   (SELECT a.volunteer_id
                    FROM donation_assignments a
                    WHERE a.donation_id = d.id AND a.ended_at IS NULL
                    LIMIT 1) AS volunteer_id
            FROM donations d
            WHERE d.id = ${donationId}::uuid AND d.deleted_at IS NULL
            FOR UPDATE OF d`;

          const result = await work(createPrismaTransitionTx(tx));
          const finalStatus = (result as { to?: string }).to;

          if (finalStatus === "CLOSED" && locked[0]) {
            await runAchievementEngine(
              { store: createPrismaAchievementStore(tx) },
              {
                donorId: locked[0].donor_id,
                volunteerId: locked[0].volunteer_id,
                donationId,
              },
            );
            const closed = await tx.$queryRaw<{ closed_at: Date | null }[]>`
              SELECT closed_at FROM donations WHERE id = ${donationId}::uuid`;
            state.closedAt = closed[0]?.closed_at ?? null;
          }

          return result;
        },
        { maxWait: 10000, timeout: 30000 },
      );
    },
  };
}

export function createDistributionCompletionTransition(): DistributionCompletionTransition {
  return async (input) => {
    const state: { closedAt: Date | null } = { closedAt: null };
    try {
      await transitionDonation(
        { store: createLockedTransitionStore(input.donationId, state) },
        input.donationId,
        "CLOSED",
        { id: input.volunteerId, role: "VOLUNTEER" },
        {
          eventNote: "Distribution report completed and reconciled.",
          metadata: { source: "distribution_completion" },
        },
      );
      return { ok: true, closedAt: state.closedAt ?? new Date() };
    } catch (error) {
      if (error instanceof DonationTransitionError) {
        if (error.code === "NOT_FOUND" || error.code === "FORBIDDEN_ACTOR") {
          return { ok: false, error: "NOT_FOUND" };
        }
        if (error.code === "INVALID_TRANSITION") {
          return { ok: false, error: "INVALID_STATE" };
        }
        if (error.code === "MISSING_PAYLOAD") {
          return { ok: false, error: "RECONCILIATION_INCOMPLETE" };
        }
      }
      throw error;
    }
  };
}
