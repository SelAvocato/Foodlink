import { z } from "zod";
import {
  adminDashboardResponseSchema,
  type AdminDashboardActivityItem,
  type AdminDashboardResponse,
} from "@/contracts/admin-dashboard";

export const DASHBOARD_ERROR = "The command center could not be loaded.";
export const REQUEST_TIMEOUT_MS = 10_000;

export const ACTIVITY_TYPE_LABEL: Record<AdminDashboardActivityItem["type"], string> = {
  REGISTRATION: "Registration",
  SCREENING: "Screening",
  DONATION_QUEUE: "Donation queue",
  ASSIGNMENT: "Assignment",
};

export function parseDashboardResponse(value: unknown): AdminDashboardResponse | null {
  const result = adminDashboardResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export async function loadDashboard(signal?: AbortSignal): Promise<AdminDashboardResponse | null> {
  try {
    const response = await fetch("/api/admin/dashboard", {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseDashboardResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export function formatActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(date);
}

export function countCards(counts: AdminDashboardResponse["counts"]) {
  return [
    {
      label: "Pending registrations",
      value: counts.pendingRegistrations,
      href: "/admin/registrations",
      variant: counts.pendingRegistrations > 0 ? "attention" : "default",
    },
    {
      label: "Screening reviews",
      value: counts.screeningReviews,
      href: "/admin/screenings",
      variant: counts.screeningReviews > 0 ? "attention" : "default",
    },
    {
      label: "Posted donations",
      value: counts.postedDonations,
      href: "/admin/donation-queue",
      variant: "default",
    },
    {
      label: "Accepted awaiting assignment",
      value: counts.acceptedAwaitingAssignment,
      href: "/admin/assignments",
      variant: counts.acceptedAwaitingAssignment > 0 ? "attention" : "default",
    },
  ] as const;
}

export function isDashboardResponse(value: unknown): value is AdminDashboardResponse {
  return adminDashboardResponseSchema.safeParse(value).success;
}

export const dashboardActivitySchema = z.array(adminDashboardResponseSchema.shape.recentActivity.element);
