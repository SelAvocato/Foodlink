import type {
  AdminPeopleListQuery,
  AdminPeopleListResponse,
  AdminPeopleRole,
  AdminPeopleStatus,
  AdminPeopleType,
  AdminPerson,
  AdminPersonStat,
} from "@/contracts/admin-people";
import { DonorType, Role } from "@/contracts/enums";
import type { DonationStatus } from "@/contracts/enums";

export interface AdminPeopleRow {
  id: string;
  role: AdminPeopleRole;
  status: AdminPeopleStatus;
  fullName: string;
  email: string;
  contactNumber: string;
  donorType: "ESTABLISHMENT" | "INDIVIDUAL" | null;
  businessName: string | null;
}

export interface AdminPersonStats {
  completedDonations: number;
  portions: number;
  peopleServed: number;
  tasksCompleted: number;
  unfinishedReports: number;
}

export interface AdminPersonActivity {
  donationId: string;
  toStatus: DonationStatus;
  occurredAt: Date;
}

export interface AdminPeopleDetails {
  stats: AdminPersonStats;
  activity: AdminPersonActivity[];
}

export interface AdminPeopleListInput {
  role: AdminPeopleRole;
  status: AdminPeopleStatus | "ALL";
  type: AdminPeopleType;
  q: string;
  skip: number;
  take: number;
}

export interface AdminPeopleCountInput {
  role: AdminPeopleRole;
  status: AdminPeopleStatus | "ALL";
  type: AdminPeopleType;
  q: string;
}

export interface AdminPeopleStore {
  findPeople(input: AdminPeopleListInput): Promise<AdminPeopleRow[]>;
  countPeople(input: AdminPeopleCountInput): Promise<number>;
  countByRole(): Promise<{ DONOR: number; VOLUNTEER: number }>;
  loadDetails(rows: AdminPeopleRow[]): Promise<Record<string, AdminPeopleDetails>>;
}

export interface AdminPeopleDeps {
  store: AdminPeopleStore;
}

const TIME_ZONE = "Asia/Manila";

const STATUS_LABELS: Record<DonationStatus, string> = {
  DRAFT: "Draft created",
  SCREENED: "Screened",
  POSTED: "Posted",
  ACCEPTED: "Accepted",
  ASSIGNED: "Assigned",
  PICKED_UP: "Picked up",
  DELIVERED: "Delivered",
  CLOSED: "Closed",
  REJECTED: "Rejected",
  DECLINED: "Declined",
  REJECTED_AT_PICKUP: "Rejected at pickup",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

function shortCode(donationId: string): string {
  return donationId.slice(0, 8).toUpperCase();
}

function formatMoment(date: Date): string {
  const time = Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", {
        timeZone: TIME_ZONE,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(date);
  return time;
}

function activityLines(activity: AdminPersonActivity[]): string[] {
  return activity.slice(0, 3).map((entry) => {
    const label = STATUS_LABELS[entry.toStatus] ?? "Updated";
    return `${label} #${shortCode(entry.donationId)} · ${formatMoment(entry.occurredAt)}`;
  });
}

function statsFor(role: AdminPeopleRole, stats: AdminPersonStats): AdminPersonStat[] {
  if (role === Role.DONOR) {
    return [
      { label: "Completed donations", value: String(stats.completedDonations) },
      { label: "Portions", value: String(stats.portions) },
      { label: "People served", value: String(stats.peopleServed) },
    ];
  }
  return [
    { label: "Tasks completed", value: String(stats.tasksCompleted) },
    { label: "Unfinished reports", value: String(stats.unfinishedReports) },
  ];
}

function mapPerson(row: AdminPeopleRow, details: AdminPeopleDetails | undefined): AdminPerson {
  const activity = activityLines(details?.activity ?? []);
  const label = row.role === Role.DONOR ? row.businessName ?? row.fullName : row.fullName;
  const title =
    row.role === Role.DONOR && row.businessName ? `${row.fullName} · ${row.businessName}` : row.fullName;
  const stats = details?.stats ?? {
    completedDonations: 0,
    portions: 0,
    peopleServed: 0,
    tasksCompleted: 0,
    unfinishedReports: 0,
  };
  return {
    id: row.id,
    kind: row.role,
    label,
    title,
    email: row.email,
    phone: row.contactNumber,
    donorType: row.role === Role.DONOR ? row.donorType ?? DonorType.INDIVIDUAL : null,
    status: row.status,
    recentActivity: activity[0] ?? "No recent activity",
    stats: statsFor(row.role, stats),
    activity,
  };
}

export async function listAdminPeople(
  deps: AdminPeopleDeps,
  query: AdminPeopleListQuery,
): Promise<AdminPeopleListResponse> {
  const pageInput = {
    role: query.role,
    status: query.status,
    type: query.type,
    q: query.q,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  };
  const countInput = {
    role: query.role,
    status: query.status,
    type: query.type,
    q: query.q,
  };
  const [rows, total, counts] = await Promise.all([
    deps.store.findPeople(pageInput),
    deps.store.countPeople(countInput),
    deps.store.countByRole(),
  ]);
  const details = await deps.store.loadDetails(rows);

  const people = rows.map((row) => mapPerson(row, details[row.id]));
  return {
    people,
    counts,
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
