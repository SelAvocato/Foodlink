import type { Prisma } from "@/generated/prisma/client";
import type {
  AchievementDefinition,
  AchievementRole,
  AchievementStats,
  AchievementStore,
  AwardedAchievement,
} from "./achievement-engine";

type DonorStatsRow = {
  donations_completed: bigint | number;
  portions_donated: bigint | number;
  people_served: bigint | number;
};

type VolunteerStatsRow = {
  tasks_completed: bigint | number;
};

type AchievementRow = {
  id: number;
  code: string;
  name: string;
  metric: AchievementDefinition["metric"];
  threshold: number;
};

export function createPrismaAchievementStore(tx: Prisma.TransactionClient): AchievementStore {
  return {
    async readDonorStats(userId): Promise<AchievementStats> {
      const rows = await tx.$queryRaw<DonorStatsRow[]>`
        SELECT donations_completed, portions_donated, people_served
        FROM v_donor_stats
        WHERE user_id = ${userId}::uuid`;
      const row = rows[0];
      return {
        donationsCompleted: Number(row?.donations_completed ?? 0),
        portionsDonated: Number(row?.portions_donated ?? 0),
        peopleServed: Number(row?.people_served ?? 0),
        tasksCompleted: 0,
      };
    },

    async readVolunteerStats(userId): Promise<AchievementStats> {
      const rows = await tx.$queryRaw<VolunteerStatsRow[]>`
        SELECT tasks_completed
        FROM v_volunteer_stats
        WHERE user_id = ${userId}::uuid`;
      return {
        donationsCompleted: 0,
        portionsDonated: 0,
        peopleServed: 0,
        tasksCompleted: Number(rows[0]?.tasks_completed ?? 0),
      };
    },

    async listActiveAchievements(role: AchievementRole): Promise<AchievementDefinition[]> {
      const rows = await tx.$queryRaw<AchievementRow[]>`
        SELECT id, code, name, metric::text AS metric, threshold
        FROM achievements
        WHERE role = ${role}::user_role
          AND is_active
          AND threshold IS NOT NULL
        ORDER BY id`;
      return rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        metric: row.metric,
        threshold: row.threshold,
      }));
    },

    async awardAchievements(userId, awards: readonly AwardedAchievement[]): Promise<number[]> {
      const newIds: number[] = [];
      for (const award of awards) {
        const metadata = {
          metric: award.metric,
          value: award.value,
          threshold: award.threshold,
        };
        const rows = await tx.$queryRaw<{ achievement_id: number }[]>`
          INSERT INTO user_achievements (user_id, achievement_id, metadata)
          VALUES (
            ${userId}::uuid,
            ${award.id}::smallint,
            ${JSON.stringify(metadata)}::jsonb
          )
          ON CONFLICT (user_id, achievement_id) DO NOTHING
          RETURNING achievement_id`;
        const inserted = rows[0];
        if (inserted) newIds.push(inserted.achievement_id);
      }
      return newIds;
    },

    async insertNotifications(rows) {
      if (rows.length === 0) return;
      await tx.notifications.createMany({
        data: rows.map((row) => ({
          user_id: row.userId,
          notification_type: row.type,
          title: row.title,
          body: row.body,
          related_donation_id: row.donationId,
        })),
      });
    },
  };
}
