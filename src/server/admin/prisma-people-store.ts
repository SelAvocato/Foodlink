import type { Prisma } from "@/generated/prisma/client";
import type { DonationStatus } from "@/contracts/enums";
import { prisma } from "@/server/db";
import type {
  AdminPeopleCountInput,
  AdminPeopleDetails,
  AdminPeopleListInput,
  AdminPeopleRow,
  AdminPeopleStore,
} from "./people";

type PeopleWhereInput = Prisma.usersWhereInput;

const ACTIVITY_TAKE = 500;

function whereFor(input: AdminPeopleCountInput | AdminPeopleListInput): PeopleWhereInput {
  const clauses: PeopleWhereInput[] = [
    {
      role: input.role,
      deleted_at: null,
      status: input.status === "ALL" ? { in: ["ACTIVE", "SUSPENDED"] } : input.status,
    },
  ];
  if (input.role === "DONOR" && input.type !== "ALL") {
    clauses.push({ donor_type: input.type });
  }
  if (input.q !== "") {
    clauses.push({
      OR: [
        { full_name: { contains: input.q, mode: "insensitive" } },
        { business_name: { contains: input.q, mode: "insensitive" } },
        { email: { contains: input.q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: clauses };
}

function emptyDetails(): AdminPeopleDetails {
  return {
    stats: {
      completedDonations: 0,
      portions: 0,
      peopleServed: 0,
      tasksCompleted: 0,
      unfinishedReports: 0,
    },
    activity: [],
  };
}

export const prismaAdminPeopleStore: AdminPeopleStore = {
  async findPeople(input: AdminPeopleListInput): Promise<AdminPeopleRow[]> {
    const users = await prisma.users.findMany({
      where: whereFor(input),
      orderBy: [{ full_name: "asc" }, { id: "asc" }],
      skip: input.skip,
      take: input.take,
      select: {
        id: true,
        role: true,
        status: true,
        full_name: true,
        email: true,
        contact_number: true,
        donor_type: true,
        business_name: true,
      },
    });
    return users.map((user) => ({
      id: user.id,
      role: user.role as AdminPeopleRow["role"],
      status: user.status as AdminPeopleRow["status"],
      fullName: user.full_name,
      email: user.email,
      contactNumber: user.contact_number,
      donorType: user.donor_type as AdminPeopleRow["donorType"],
      businessName: user.business_name,
    }));
  },

  async countPeople(input: AdminPeopleCountInput): Promise<number> {
    return prisma.users.count({ where: whereFor(input) });
  },

  async countByRole(): Promise<{ DONOR: number; VOLUNTEER: number }> {
    const grouped = await prisma.users.groupBy({
      by: ["role"],
      where: {
        role: { in: ["DONOR", "VOLUNTEER"] },
        status: { in: ["ACTIVE", "SUSPENDED"] },
        deleted_at: null,
      },
      _count: { _all: true },
    });
    const counts = { DONOR: 0, VOLUNTEER: 0 };
    for (const row of grouped) {
      if (row.role === "DONOR") counts.DONOR = row._count._all;
      if (row.role === "VOLUNTEER") counts.VOLUNTEER = row._count._all;
    }
    return counts;
  },

  async loadDetails(rows: AdminPeopleRow[]): Promise<Record<string, AdminPeopleDetails>> {
    const details: Record<string, AdminPeopleDetails> = {};
    for (const row of rows) details[row.id] = emptyDetails();
    if (rows.length === 0) return details;

    const donorIds = rows.filter((row) => row.role === "DONOR").map((row) => row.id);
    const volunteerIds = rows.filter((row) => row.role === "VOLUNTEER").map((row) => row.id);

    const [closedGroups, donorDonations, assignments, unfinishedDonations, donorEvents, volunteerEvents] =
      await Promise.all([
        donorIds.length === 0
          ? []
          : prisma.donations.groupBy({
              by: ["donor_id"],
              where: { donor_id: { in: donorIds }, status: "CLOSED", deleted_at: null },
              _count: { _all: true },
              _sum: { portions: true },
            }),
        donorIds.length === 0
          ? []
          : prisma.donations.findMany({
              where: { donor_id: { in: donorIds }, deleted_at: null },
              select: {
                donor_id: true,
                distribution_entries: { select: { people_served: true } },
              },
            }),
        volunteerIds.length === 0
          ? []
          : prisma.donation_assignments.findMany({
              where: {
                volunteer_id: { in: volunteerIds },
                donations: { status: "CLOSED", deleted_at: null },
              },
              select: { volunteer_id: true, donation_id: true },
            }),
        volunteerIds.length === 0
          ? []
          : prisma.donations.findMany({
              where: {
                deleted_at: null,
                status: "DELIVERED",
                distribution_entries: { none: {} },
                donation_assignments: { volunteer_id: { in: volunteerIds }, ended_at: null },
              },
              select: { donation_assignments: { select: { volunteer_id: true } } },
            }),
        donorIds.length === 0
          ? []
          : prisma.donation_tracking_events.findMany({
              where: { donations: { donor_id: { in: donorIds }, deleted_at: null } },
              orderBy: { occurred_at: "desc" },
              take: ACTIVITY_TAKE,
              select: {
                donation_id: true,
                to_status: true,
                occurred_at: true,
                donations: { select: { donor_id: true } },
              },
            }),
        volunteerIds.length === 0
          ? []
          : prisma.donation_tracking_events.findMany({
              where: { actor_user_id: { in: volunteerIds } },
              orderBy: { occurred_at: "desc" },
              take: ACTIVITY_TAKE,
              select: { actor_user_id: true, donation_id: true, to_status: true, occurred_at: true },
            }),
      ]);

    for (const group of closedGroups) {
      const current = details[group.donor_id];
      if (!current) continue;
      current.stats.completedDonations = group._count._all;
      current.stats.portions = group._sum.portions ?? 0;
    }
    for (const donation of donorDonations) {
      const current = details[donation.donor_id];
      if (!current) continue;
      current.stats.peopleServed += donation.distribution_entries.reduce(
        (sum, entry) => sum + entry.people_served,
        0,
      );
    }

    const completedByVolunteer = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      const seen = completedByVolunteer.get(assignment.volunteer_id) ?? new Set<string>();
      seen.add(assignment.donation_id);
      completedByVolunteer.set(assignment.volunteer_id, seen);
    }
    for (const [volunteerId, donationIds] of completedByVolunteer) {
      const current = details[volunteerId];
      if (current) current.stats.tasksCompleted = donationIds.size;
    }
    for (const donation of unfinishedDonations) {
      const volunteerId = donation.donation_assignments?.volunteer_id;
      const current = volunteerId ? details[volunteerId] : undefined;
      if (current) current.stats.unfinishedReports += 1;
    }

    for (const event of donorEvents) {
      const current = details[event.donations.donor_id];
      if (!current || current.activity.length >= 3) continue;
      current.activity.push({
        donationId: event.donation_id,
        toStatus: event.to_status as DonationStatus,
        occurredAt: event.occurred_at,
      });
    }
    for (const event of volunteerEvents) {
      const volunteerId = event.actor_user_id;
      if (!volunteerId) continue;
      const current = details[volunteerId];
      if (!current || current.activity.length >= 3) continue;
      current.activity.push({
        donationId: event.donation_id,
        toStatus: event.to_status as DonationStatus,
        occurredAt: event.occurred_at,
      });
    }

    return details;
  },
};
