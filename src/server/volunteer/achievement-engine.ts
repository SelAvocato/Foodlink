export type AchievementMetric =
  | "DONATIONS_COMPLETED"
  | "PORTIONS_DONATED"
  | "PEOPLE_SERVED"
  | "TASKS_COMPLETED";

export type AchievementRole = "DONOR" | "VOLUNTEER";

export type AchievementStats = {
  donationsCompleted: number;
  portionsDonated: number;
  peopleServed: number;
  tasksCompleted: number;
};

export type AchievementDefinition = {
  id: number;
  code: string;
  name: string;
  metric: AchievementMetric;
  threshold: number;
};

export type AwardedAchievement = AchievementDefinition & {
  value: number;
};

export type AchievementNotification = {
  userId: string;
  type: "ACHIEVEMENT_EARNED";
  title: string;
  body: string;
  donationId: string;
};

export interface AchievementStore {
  readDonorStats(userId: string): Promise<AchievementStats>;
  readVolunteerStats(userId: string): Promise<AchievementStats>;
  listActiveAchievements(role: AchievementRole): Promise<AchievementDefinition[]>;
  /** Inserts only the missing rows and returns the ids that were new. */
  awardAchievements(userId: string, awards: readonly AwardedAchievement[]): Promise<number[]>;
  insertNotifications(rows: readonly AchievementNotification[]): Promise<void>;
}

export type AchievementRunResult = {
  donorAwards: AwardedAchievement[];
  volunteerAwards: AwardedAchievement[];
};

const EMPTY_STATS: AchievementStats = {
  donationsCompleted: 0,
  portionsDonated: 0,
  peopleServed: 0,
  tasksCompleted: 0,
};

export function statsWithDefaults(stats: Partial<AchievementStats> | null | undefined): AchievementStats {
  return { ...EMPTY_STATS, ...(stats ?? {}) };
}

function metricValue(stats: AchievementStats, metric: AchievementMetric): number {
  switch (metric) {
    case "DONATIONS_COMPLETED":
      return stats.donationsCompleted;
    case "PORTIONS_DONATED":
      return stats.portionsDonated;
    case "PEOPLE_SERVED":
      return stats.peopleServed;
    case "TASKS_COMPLETED":
      return stats.tasksCompleted;
  }
}

export function selectEligibleAchievements(
  definitions: readonly AchievementDefinition[],
  stats: AchievementStats,
): AwardedAchievement[] {
  return definitions
    .filter((definition) => definition.threshold > 0)
    .map((definition) => ({
      ...definition,
      value: metricValue(stats, definition.metric),
    }))
    .filter((award) => award.value >= award.threshold);
}

function notificationFor(userId: string, award: AwardedAchievement, donationId: string): AchievementNotification {
  return {
    userId,
    type: "ACHIEVEMENT_EARNED",
    title: `Achievement unlocked: ${award.name}`,
    body: `${award.name} earned with ${award.value} toward a target of ${award.threshold}.`,
    donationId,
  };
}

async function runForUser(
  store: AchievementStore,
  input: {
    userId: string;
    role: AchievementRole;
    donationId: string;
    stats: AchievementStats;
  },
): Promise<AwardedAchievement[]> {
  const definitions = await store.listActiveAchievements(input.role);
  const eligible = selectEligibleAchievements(definitions, input.stats);
  if (eligible.length === 0) return [];

  const newIds = new Set(await store.awardAchievements(input.userId, eligible));
  const awarded = eligible.filter((award) => newIds.has(award.id));
  if (awarded.length > 0) {
    await store.insertNotifications(
      awarded.map((award) => notificationFor(input.userId, award, input.donationId)),
    );
  }
  return awarded;
}

/**
 * Runs inside the DELIVERED -> CLOSED transaction. The stats views include the
 * donation being closed, so the totals and any milestone badge are written in
 * the same transaction as the status change.
 */
export async function runAchievementEngine(
  deps: { store: AchievementStore },
  input: { donorId: string; volunteerId: string | null; donationId: string },
): Promise<AchievementRunResult> {
  const { store } = deps;

  const donorStats = statsWithDefaults(await store.readDonorStats(input.donorId));
  const donorAwards = await runForUser(store, {
    userId: input.donorId,
    role: "DONOR",
    donationId: input.donationId,
    stats: donorStats,
  });

  if (!input.volunteerId) {
    return { donorAwards, volunteerAwards: [] };
  }

  const volunteerStats = statsWithDefaults(await store.readVolunteerStats(input.volunteerId));
  const volunteerAwards = await runForUser(store, {
    userId: input.volunteerId,
    role: "VOLUNTEER",
    donationId: input.donationId,
    stats: volunteerStats,
  });

  return { donorAwards, volunteerAwards };
}
