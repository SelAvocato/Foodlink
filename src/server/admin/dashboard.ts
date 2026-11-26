import type {
  AdminDashboardActivityItem,
  AdminDashboardCounts,
  AdminDashboardResponse,
} from "@/contracts/admin-dashboard";

export interface DashboardRegistrationRow {
  id: string;
  fullName: string;
  role: "DONOR" | "VOLUNTEER";
  createdAt: Date;
}

export interface DashboardScreeningRow {
  screeningId: string;
  donationId: string;
  foodName: string;
  createdAt: Date;
}

export interface DashboardPostedDonationRow {
  donationId: string;
  foodName: string;
  donorName: string;
  postedAt: Date | null;
  pickupEnd: Date | null;
}

export interface DashboardAcceptedDonationRow {
  donationId: string;
  foodName: string;
  donorName: string;
  pickupEnd: Date;
}

export interface AdminDashboardStore {
  countPendingRegistrations(): Promise<number>;
  countScreeningReviews(): Promise<number>;
  countPostedDonations(): Promise<number>;
  countAcceptedAwaitingAssignment(now: Date): Promise<number>;
  listRecentRegistrations(limit: number): Promise<DashboardRegistrationRow[]>;
  listRecentScreenings(limit: number): Promise<DashboardScreeningRow[]>;
  listRecentPostedDonations(limit: number): Promise<DashboardPostedDonationRow[]>;
  listRecentAcceptedDonations(now: Date, limit: number): Promise<DashboardAcceptedDonationRow[]>;
}

const RECENT_SOURCE_LIMIT = 5;
const RECENT_TOTAL_LIMIT = 8;

function asIso(value: Date | null | undefined): string | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function toNonNegativeInt(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function getAdminDashboard(
  deps: { store: AdminDashboardStore },
  input: { now: Date },
): Promise<AdminDashboardResponse> {
  const [pendingRegistrations, screeningReviews, postedDonations, acceptedAwaitingAssignment, registrations, screenings, posted, accepted] =
    await Promise.all([
      deps.store.countPendingRegistrations(),
      deps.store.countScreeningReviews(),
      deps.store.countPostedDonations(),
      deps.store.countAcceptedAwaitingAssignment(input.now),
      deps.store.listRecentRegistrations(RECENT_SOURCE_LIMIT),
      deps.store.listRecentScreenings(RECENT_SOURCE_LIMIT),
      deps.store.listRecentPostedDonations(RECENT_SOURCE_LIMIT),
      deps.store.listRecentAcceptedDonations(input.now, RECENT_SOURCE_LIMIT),
    ]);

  const counts: AdminDashboardCounts = {
    pendingRegistrations: toNonNegativeInt(pendingRegistrations),
    screeningReviews: toNonNegativeInt(screeningReviews),
    postedDonations: toNonNegativeInt(postedDonations),
    acceptedAwaitingAssignment: toNonNegativeInt(acceptedAwaitingAssignment),
  };

  const recentActivity: AdminDashboardActivityItem[] = [
    ...registrations.flatMap((row) => {
      const occurredAt = asIso(row.createdAt);
      if (!occurredAt) return [];
      const roleLabel = row.role === "DONOR" ? "Donor" : "Volunteer";
      return [{
        id: `registration:${row.id}`,
        type: "REGISTRATION" as const,
        title: `${roleLabel} registration pending`,
        detail: row.fullName || "Pending account review",
        occurredAt,
        href: "/admin/registrations",
      }];
    }),
    ...screenings.flatMap((row) => {
      const occurredAt = asIso(row.createdAt);
      if (!occurredAt) return [];
      return [{
        id: `screening:${row.screeningId}`,
        type: "SCREENING" as const,
        title: "Screening review needed",
        detail: row.foodName || "Donation screening",
        occurredAt,
        href: "/admin/screenings",
      }];
    }),
    ...posted.flatMap((row) => {
      const occurredAt = asIso(row.postedAt ?? row.pickupEnd);
      if (!occurredAt) return [];
      return [{
        id: `queue:${row.donationId}`,
        type: "DONATION_QUEUE" as const,
        title: "Donation posted for review",
        detail: [row.foodName, row.donorName].filter(Boolean).join(" - ") || "Posted donation",
        occurredAt,
        href: "/admin/donation-queue",
      }];
    }),
    ...accepted.flatMap((row) => {
      const occurredAt = asIso(row.pickupEnd);
      if (!occurredAt) return [];
      return [{
        id: `assignment:${row.donationId}`,
        type: "ASSIGNMENT" as const,
        title: "Donation awaiting assignment",
        detail: [row.foodName, row.donorName].filter(Boolean).join(" - ") || "Accepted donation",
        occurredAt,
        href: `/admin/assignments?donation=${encodeURIComponent(row.donationId)}`,
      }];
    }),
  ]
    .sort((a, b) => {
      const time = b.occurredAt.localeCompare(a.occurredAt);
      return time !== 0 ? time : a.id.localeCompare(b.id);
    })
    .slice(0, RECENT_TOTAL_LIMIT);

  return { counts, recentActivity };
}
