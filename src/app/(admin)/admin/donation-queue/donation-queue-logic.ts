import { z } from "zod";
import { formatDateTime, formatWindow } from "@/app/(donor)/donor/donate/review-logic";

export const REQUEST_TIMEOUT_MS = 10_000;
export const QUEUE_LIMIT = 100;
export const PAGE_SIZE = 10;
export const REASON_MAX = 500;

/** The static page's sentence; also shown when a refusal says the row was already handled. */
export const NOTICE =
  "If another staff member has already handled the donation, no duplicate acceptance is created. Refresh the queue.";

const DASH = "—";
const ALL_CATEGORIES = "all";

/** One queue row as JSON arrives: AdminDonationQueueItem with ISO date strings. */
export type DonationQueueJson = {
  donationId: string;
  foodName: string;
  category: string;
  portions: number;
  donorName: string;
  donorType: string;
  pickupAddress: string | null;
  pickupStart: string | null;
  pickupEnd: string | null;
  postedAt: string | null;
};

const queueItemSchema = z.object({
  donationId: z.string(),
  foodName: z.string(),
  category: z.string(),
  portions: z.number(),
  donorName: z.string(),
  donorType: z.string(),
  pickupAddress: z.string().nullable(),
  pickupStart: z.string().nullable(),
  pickupEnd: z.string().nullable(),
  postedAt: z.string().nullable(),
});

const queueResponseSchema = z.object({ donations: z.array(queueItemSchema) });

/** The queue answer if it has the expected shape, otherwise null. */
export function parseQueueResponse(body: unknown): DonationQueueJson[] | null {
  const parsed = queueResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.donations : null;
}

/** "4 Nov 2026 · 3:00–5:00 PM" in the browser time zone; a dash when either end is missing. */
export function windowLabel(
  start: string | null,
  end: string | null,
  timeZone?: string,
): string {
  if (start === null || end === null) return DASH;
  return formatWindow(start, end, timeZone) ?? DASH;
}

/**
 * Expiry is the pickup end: the schema has no expires_at column, so pickup_end is the
 * single source of truth. Shown in the same date and time format as the pickup label.
 */
export function expiryLabel(pickupEnd: string | null, timeZone?: string): string {
  if (pickupEnd === null) return DASH;
  return formatDateTime(pickupEnd, timeZone) ?? DASH;
}

/** The pickup address as text; a dash when the queue row has none. */
export function addressLabel(address: string | null): string {
  return address === null || address.trim() === "" ? DASH : address;
}

/** "All categories" plus every category on the loaded rows, sorted. */
export function buildCategoryOptions(
  rows: readonly DonationQueueJson[],
): { value: string; label: string }[] {
  const names = Array.from(new Set(rows.map((row) => row.category))).sort();
  return [{ value: ALL_CATEGORIES, label: "All categories" }].concat(
    names.map((name) => ({ value: name, label: name })),
  );
}

/** Search food and donor name (case-insensitive) and, optionally, one category. */
export function filterRows(
  rows: readonly DonationQueueJson[],
  input: { query: string; category: string },
): DonationQueueJson[] {
  const q = input.query.trim().toLowerCase();
  return rows.filter((row) => {
    if (input.category !== ALL_CATEGORIES && row.category !== input.category) return false;
    if (q === "") return true;
    return row.foodName.toLowerCase().includes(q) || row.donorName.toLowerCase().includes(q);
  });
}

function deadlineMs(row: DonationQueueJson): number | null {
  if (row.pickupEnd === null) return null;
  const ms = Date.parse(row.pickupEnd);
  return Number.isNaN(ms) ? null : ms;
}

/** Soonest pickup end first when ascending; a missing or unreadable end sorts last either way. */
export function sortByDeadline(
  rows: readonly DonationQueueJson[],
  ascending: boolean,
): DonationQueueJson[] {
  return [...rows].sort((a, b) => {
    const first = deadlineMs(a);
    const second = deadlineMs(b);
    if (first === null && second === null) return 0;
    if (first === null) return 1;
    if (second === null) return -1;
    return ascending ? first - second : second - first;
  });
}

/** At least 1, so the pager never gets zero pages. */
export function pageCount(total: number, pageSize: number = PAGE_SIZE): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The requested page clamped to the pages that exist. */
export function safePage(page: number, total: number, pageSize: number = PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}

/** The rows of one page; a page past the end is an empty slice. */
export function pageSlice<T>(rows: readonly T[], page: number, pageSize: number = PAGE_SIZE): T[] {
  const start = (safePage(page, rows.length, pageSize) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** "Showing 1–10 of 24", as on the static page. */
export function summaryText(input: {
  page: number;
  total: number;
  pageSize?: number;
}): string {
  const size = input.pageSize ?? PAGE_SIZE;
  if (input.total === 0) return "Showing 0–0 of 0";
  const page = safePage(input.page, input.total, size);
  const first = (page - 1) * size + 1;
  const last = Math.min(page * size, input.total);
  return `Showing ${first}–${last} of ${input.total}`;
}

/** The decline reason after trimming; the same two messages the static dialog used. */
export type ReasonValidation =
  | { ok: true; reason: string }
  | { ok: false; message: string };

export function validateReason(raw: string): ReasonValidation {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "A reason is required." };
  if (text.length > REASON_MAX) return { ok: false, message: "Use at most 500 characters." };
  return { ok: true, reason: text };
}

/**
 * What the screen shows for an Admin action's failure. The statuses are the ones
 * transitionErrorResponse produces: NOT_FOUND 404, FORBIDDEN_ACTOR 403,
 * INVALID_TRANSITION 409, VOLUNTEER_NOT_ACTIVE 422, otherwise 400; 401 is the
 * auth gate and 500 the action wrapper's internal error.
 */
export type TransitionFailureView = {
  tone: "warning" | "error";
  title: string;
  message: string;
  /** The loaded queue no longer agrees with the server, so it must be re-read. */
  reload: boolean;
  /** A refusal from the transition rules; false means an unexpected failure. */
  refusal: boolean;
};

export function transitionFailure(status: number): TransitionFailureView {
  if (status === 401) {
    return {
      tone: "error",
      title: "Not signed in",
      message: "Your session has expired. Sign in again.",
      reload: false,
      refusal: true,
    };
  }
  if (status === 403) {
    return {
      tone: "warning",
      title: "Not allowed",
      message: "Your account cannot handle this donation.",
      reload: false,
      refusal: true,
    };
  }
  if (status === 404) {
    return {
      tone: "warning",
      title: "Donation not found",
      message: "This donation no longer exists. The queue has been refreshed.",
      reload: true,
      refusal: true,
    };
  }
  if (status === 409) {
    return {
      tone: "warning",
      title: "Already handled",
      message: NOTICE,
      reload: true,
      refusal: true,
    };
  }
  if (status === 422) {
    return {
      tone: "warning",
      title: "Volunteer not active",
      message: "The volunteer on this donation is not active.",
      reload: false,
      refusal: true,
    };
  }
  if (status === 400) {
    return {
      tone: "error",
      title: "Request refused",
      message: "The request was not valid. Refresh the queue and try again.",
      reload: true,
      refusal: true,
    };
  }
  return {
    tone: "error",
    title: "Something went wrong",
    message: "The donation could not be updated. Please try again.",
    reload: false,
    refusal: false,
  };
}

export type ReportDetail = {
  expiry: string;
  packaging: string;
  allergens: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function namesText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return "None declared";
  const names: string[] = [];
  for (const name of value) {
    if (typeof name !== "string" || name.trim() === "") return null;
    names.push(name);
  }
  return names.join(", ");
}

/**
 * The three lines the static card shows, read only from keys the ADMIN report
 * really has. Packaging: true "Packaging intact", false "Packaging not intact",
 * null or missing "Packaging not recorded". Allergens: [] "None declared"; a
 * missing key is "Not recorded", never an invented "None declared".
 */
export function reportDetail(report: unknown, timeZone?: string): ReportDetail {
  const root = asRecord(report);
  const pickup = root === null ? null : asRecord(root.pickup);
  const pickupEnd =
    pickup !== null && typeof pickup.pickup_end === "string" ? pickup.pickup_end : null;

  const checklist = root === null ? null : asRecord(root.safety_checklist);
  let packaging = "Packaging not recorded";
  if (checklist !== null && Object.hasOwn(checklist, "packaging_intact")) {
    if (checklist.packaging_intact === true) packaging = "Packaging intact";
    else if (checklist.packaging_intact === false) packaging = "Packaging not intact";
  }

  let allergens = "Not recorded";
  if (root !== null && Object.hasOwn(root, "allergens")) {
    const text = namesText(root.allergens);
    if (text !== null) allergens = text;
  }

  return { expiry: expiryLabel(pickupEnd, timeZone), packaging, allergens };
}

/** A notice when the queue came back full, so a cutoff at the limit is never silent. */
export function queueLimitNotice(total: number): string | null {
  return total >= QUEUE_LIMIT
    ? "Showing the first " + String(QUEUE_LIMIT) + " donations. More may be waiting."
    : null;
}
