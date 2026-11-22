import { describe, expect, it } from "vitest";
import {
  runAchievementEngine,
  selectEligibleAchievements,
  statsWithDefaults,
  type AchievementDefinition,
  type AchievementNotification,
  type AchievementRole,
  type AchievementStats,
  type AchievementStore,
  type AwardedAchievement,
} from "./achievement-engine";

const DONOR_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "22222222-2222-4222-8222-222222222222";
const DONATION_ID = "33333333-3333-4333-8333-333333333333";

const DONOR_TEN: AchievementDefinition = {
  id: 1,
  code: "DONOR_10_DONATIONS",
  name: "Ten donations",
  metric: "DONATIONS_COMPLETED",
  threshold: 10,
};
const DONOR_PORTIONS: AchievementDefinition = {
  id: 2,
  code: "DONOR_100_PORTIONS",
  name: "Hundred portions",
  metric: "PORTIONS_DONATED",
  threshold: 100,
};
const VOLUNTEER_TASKS: AchievementDefinition = {
  id: 3,
  code: "VOLUNTEER_5_TASKS",
  name: "Five tasks",
  metric: "TASKS_COMPLETED",
  threshold: 5,
};

class FakeStore implements AchievementStore {
  donorStats: AchievementStats = statsWithDefaults({});
  volunteerStats: AchievementStats = statsWithDefaults({});
  definitions: Record<AchievementRole, AchievementDefinition[]> = {
    DONOR: [DONOR_TEN, DONOR_PORTIONS],
    VOLUNTEER: [VOLUNTEER_TASKS],
  };
  existing = new Set<number>();
  notifications: AchievementNotification[] = [];

  async readDonorStats(): Promise<AchievementStats> {
    return this.donorStats;
  }

  async readVolunteerStats(): Promise<AchievementStats> {
    return this.volunteerStats;
  }

  async listActiveAchievements(role: AchievementRole): Promise<AchievementDefinition[]> {
    return this.definitions[role];
  }

  async awardAchievements(
    _userId: string,
    awards: readonly AwardedAchievement[],
  ): Promise<number[]> {
    const inserted: number[] = [];
    for (const award of awards) {
      if (!this.existing.has(award.id)) {
        this.existing.add(award.id);
        inserted.push(award.id);
      }
    }
    return inserted;
  }

  async insertNotifications(rows: readonly AchievementNotification[]): Promise<void> {
    this.notifications.push(...rows);
  }
}

describe("selectEligibleAchievements", () => {
  it("returns only achievements whose metric reached the threshold", () => {
    const awards = selectEligibleAchievements([DONOR_TEN, DONOR_PORTIONS], {
      donationsCompleted: 10,
      portionsDonated: 99,
      peopleServed: 0,
      tasksCompleted: 0,
    });

    expect(awards).toEqual([{ ...DONOR_TEN, value: 10 }]);
  });

  it("ignores a non-positive threshold", () => {
    expect(
      selectEligibleAchievements([{ ...DONOR_TEN, threshold: 0 }], {
        donationsCompleted: 100,
        portionsDonated: 100,
        peopleServed: 100,
        tasksCompleted: 100,
      }),
    ).toEqual([]);
  });
});

describe("runAchievementEngine", () => {
  it("awards donor and volunteer milestones and notifies both", async () => {
    const store = new FakeStore();
    store.donorStats = statsWithDefaults({
      donationsCompleted: 10,
      portionsDonated: 120,
      peopleServed: 200,
    });
    store.volunteerStats = statsWithDefaults({ tasksCompleted: 5 });

    const result = await runAchievementEngine(
      { store },
      { donorId: DONOR_ID, volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
    );

    expect(result.donorAwards.map((award) => award.code)).toEqual([
      DONOR_TEN.code,
      DONOR_PORTIONS.code,
    ]);
    expect(result.volunteerAwards.map((award) => award.code)).toEqual([
      VOLUNTEER_TASKS.code,
    ]);
    expect(store.notifications).toHaveLength(3);
    expect(store.notifications[0]).toMatchObject({
      userId: DONOR_ID,
      type: "ACHIEVEMENT_EARNED",
      donationId: DONATION_ID,
    });
  });

  it("does not notify an achievement the user already has", async () => {
    const store = new FakeStore();
    store.donorStats = statsWithDefaults({ donationsCompleted: 10 });
    store.existing.add(DONOR_TEN.id);

    const result = await runAchievementEngine(
      { store },
      { donorId: DONOR_ID, volunteerId: null, donationId: DONATION_ID },
    );

    expect(result.donorAwards).toEqual([]);
    expect(store.notifications).toEqual([]);
  });

  it("skips volunteer work when there is no current volunteer", async () => {
    const store = new FakeStore();
    store.donorStats = statsWithDefaults({ donationsCompleted: 1 });

    const result = await runAchievementEngine(
      { store },
      { donorId: DONOR_ID, volunteerId: null, donationId: DONATION_ID },
    );

    expect(result).toEqual({ donorAwards: [], volunteerAwards: [] });
    expect(store.notifications).toEqual([]);
  });
});
