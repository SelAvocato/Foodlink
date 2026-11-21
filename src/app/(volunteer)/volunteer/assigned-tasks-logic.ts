import { z } from "zod";
import {
  VOLUNTEER_DONATION_STATUSES,
  type VolunteerDonationStatus,
} from "@/contracts/volunteer-donation-list";
import { formatWindow } from "@/app/(donor)/donor/donate/review-logic";

export const REQUEST_TIMEOUT_MS = 10_000;
export const PAGE_SIZE = 50;

const NOT_SET = "Not set";

const STATUS_LABELS: Record<VolunteerDonationStatus, string> = {
  ASSIGNED: "Assigned",
  PICKED_UP: "Picked up",
  DELIVERED: "Delivered",
};

const itemSchema = z.object({
  donationId: z.string(),
  shortCode: z.string(),
  foodName: z.string(),
  category: z.string(),
  portions: z.number(),
  status: z.enum(VOLUNTEER_DONATION_STATUSES),
  pickupAddress: z.string().nullable(),
  pickupStart: z.string().nullable(),
  pickupEnd: z.string().nullable(),
  donorName: z.string(),
  donorPhone: z.string(),
});

const responseSchema = z.object({
  items: z.array(itemSchema),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
});

/** One list item as the view uses it (JSON dates are ISO strings). */
export type TaskItem = z.infer<typeof itemSchema>;

/** The list answer as its items, or null when any part of the body is wrong. */
export function parseTasksResponse(body: unknown): TaskItem[] | null {
  const parsed = responseSchema.safeParse(body);
  return parsed.success ? parsed.data.items : null;
}

/** "#" + the short code; a leading "#" in the value is never doubled. */
export function taskCode(shortCode: string): string {
  return `#${shortCode.replace(/^#/, "")}`;
}

/** One table row, already formatted for display; carries no donor contact details. */
export type TaskRowView = {
  id: string;
  /** "#9FC03951" */
  code: string;
  food: string;
  location: string;
  window: string;
  status: string;
  action: string;
};

export function mapRow(item: TaskItem, timeZone?: string): TaskRowView {
  const window =
    item.pickupStart !== null && item.pickupEnd !== null
      ? formatWindow(item.pickupStart, item.pickupEnd, timeZone)
      : null;
  return {
    id: item.donationId,
    code: taskCode(item.shortCode),
    food: item.foodName,
    location: item.pickupAddress ?? NOT_SET,
    window: window ?? NOT_SET,
    status: STATUS_LABELS[item.status],
    action: item.status === "DELIVERED" ? "Record distribution" : "View task",
  };
}

/** The green strip's three lines; both parts of line two always show, including zeros. */
export type BannerView = {
  headline: string;
  awaiting: string;
  reports: string;
};

export function bannerText(items: readonly TaskItem[]): BannerView {
  const assigned = items.filter((item) => item.status === "ASSIGNED").length;
  const pickedUp = items.filter((item) => item.status === "PICKED_UP").length;
  const delivered = items.filter((item) => item.status === "DELIVERED").length;
  const active = assigned + pickedUp;
  return {
    headline: `${active} active ${active === 1 ? "task" : "tasks"}`,
    awaiting: `${assigned} awaiting pickup`,
    reports: `${delivered} distribution ${delivered === 1 ? "report" : "reports"} unfinished`,
  };
}

/** Everything the search matches against; deliberately excludes donor contact details. */
export function searchHaystack(item: TaskItem): string {
  return `${item.foodName} ${item.shortCode.replace(/^#/, "")}`.toLowerCase();
}

/** Case-insensitive on the food name and on the code, with or without the "#". */
export function matchesSearch(item: TaskItem, search: string): boolean {
  const raw = search.trim().toLowerCase();
  if (raw === "") return true;
  return searchHaystack(item).includes(raw.replace(/^#/, ""));
}

function matchesStatus(item: TaskItem, status: string): boolean {
  if (status === "all") return true;
  if (status === "assigned") return item.status === "ASSIGNED";
  if (status === "picked-up") return item.status === "PICKED_UP";
  if (status === "delivered") return item.status === "DELIVERED";
  return false;
}

/** pickupStart falls on now's calendar day in the local time zone; null never matches. */
export function isToday(iso: string | null, now: Date): boolean {
  if (iso === null) return false;
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return false;
  return (
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate()
  );
}

function matchesDate(item: TaskItem, date: string, now: Date): boolean {
  if (date === "all") return true;
  if (date === "today") return isToday(item.pickupStart, now);
  return false;
}

export type TaskFilters = {
  search: string;
  status: string;
  date: string;
  /** Injected so "Today" never depends on the clock in tests. */
  now: Date;
};

/** The filters applied to the rows already loaded (the list route has no search or date parameter). */
export function filterItems(items: readonly TaskItem[], filters: TaskFilters): TaskItem[] {
  return items.filter(
    (item) =>
      matchesSearch(item, filters.search) &&
      matchesStatus(item, filters.status) &&
      matchesDate(item, filters.date, filters.now),
  );
}

/** The ASSIGNED row with the earliest pickupEnd; null pickupEnd sorts last, ties keep list order. */
function soonestAssigned(items: readonly TaskItem[]): TaskItem | null {
  let best: TaskItem | null = null;
  for (const item of items) {
    if (item.status !== "ASSIGNED") continue;
    if (best === null) {
      best = item;
      continue;
    }
    if (item.pickupEnd === null) continue;
    if (best.pickupEnd === null) {
      best = item;
      continue;
    }
    if (Date.parse(item.pickupEnd) < Date.parse(best.pickupEnd)) best = item;
  }
  return best;
}

/** "Pickup task: name · phone · address" for the soonest ASSIGNED row; null when there is none. */
export function contactLine(items: readonly TaskItem[]): string | null {
  const chosen = soonestAssigned(items);
  if (chosen === null) return null;
  let line = `Pickup task: ${chosen.donorName} · ${chosen.donorPhone}`;
  if (chosen.pickupAddress !== null) line += ` · ${chosen.pickupAddress}`;
  return line;
}

/** Empty copy: the list itself is empty, or the filters hid every loaded row. */
export function emptyState(filtered: boolean): { title: string; description?: string } {
  if (filtered) {
    return { title: "No matching tasks", description: "Try a different search or filter." };
  }
  return { title: "No assigned tasks yet" };
}

export type LoadFailure = "session" | "error";

/** 401 or 403 means the session or role is wrong, so "check your connection" would mislead. */
export function loadFailure(status: number): LoadFailure {
  return status === 401 || status === 403 ? "session" : "error";
}

/** Milliseconds until just after the next local midnight, when "Today" changes. */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}
