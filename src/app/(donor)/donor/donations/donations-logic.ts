import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import {
  DONOR_DONATION_TAB_STATUSES,
  donorDonationTabs,
  type DonorDonationTab,
  type DonorDonationTabCounts,
} from "@/contracts/donor-donation-list";
import type { TabItem } from "@/components/shared/tab-bar";
import { formatDateTime, formatWindow } from "@/app/(donor)/donor/donate/review-logic";
import type { DonationRowView, HighlightCardView } from "./donations-view";

export const DEFAULT_PAGE_SIZE = 20;
export const SEARCH_DEBOUNCE_MS = 300;
export const REQUEST_TIMEOUT_MS = 10_000;
// The server refuses a longer search with 400, so the client cuts it first.
const SEARCH_MAX_LENGTH = 100;
const DASH = "—";

/** One list row as it arrives in JSON (dates are ISO strings). */
export type DonationListItemJson = {
  donationId: string;
  shortCode: string;
  foodName: string;
  category: string;
  portions: number;
  status: string;
  pickupStart: string | null;
  pickupEnd: string | null;
  updatedAt: string;
  checklistComplete: boolean;
};

const TAB_LABELS: Record<DonorDonationTab, string> = {
  drafts: "Drafts",
  active: "Active",
  completed: "Completed",
  not_completed: "Not completed",
};

// Used inside the summary line: "Showing 1–20 of 24 active donations".
const TAB_WORDS: Record<DonorDonationTab, string> = {
  drafts: "draft",
  active: "active",
  completed: "completed",
  not_completed: "not completed",
};

const COUNT_KEY: Record<DonorDonationTab, keyof DonorDonationTabCounts> = {
  drafts: "drafts",
  active: "active",
  completed: "completed",
  not_completed: "notCompleted",
};

// Record over the enum: a new status fails typecheck until it gets a label.
const STATUS_LABELS: Record<DonationStatus, string> = {
  [DonationStatus.DRAFT]: "Draft",
  [DonationStatus.SCREENED]: "Screened",
  [DonationStatus.POSTED]: "Posted",
  [DonationStatus.ACCEPTED]: "Accepted",
  [DonationStatus.ASSIGNED]: "Assigned",
  [DonationStatus.PICKED_UP]: "Picked up",
  [DonationStatus.DELIVERED]: "Delivered",
  [DonationStatus.CLOSED]: "Closed",
  [DonationStatus.REJECTED]: "Rejected",
  [DonationStatus.DECLINED]: "Declined",
  [DonationStatus.REJECTED_AT_PICKUP]: "Rejected at pickup",
  [DonationStatus.CANCELLED]: "Cancelled",
  [DonationStatus.EXPIRED]: "Expired",
};

const EMPTY_TEXT: Record<DonorDonationTab, { title: string; description: string }> = {
  drafts: {
    title: "No drafts",
    description: "Donations you started but have not posted will appear here.",
  },
  active: {
    title: "No active donations",
    description: "Posted donations that are waiting for pickup or delivery will appear here.",
  },
  completed: {
    title: "No completed donations yet",
    description: "Donations that have been delivered and closed will appear here.",
  },
  not_completed: {
    title: "Nothing to show here",
    description: "Rejected, declined, cancelled and expired donations will appear here.",
  },
};

function isStatus(value: string): value is DonationStatus {
  return (Object.values(DonationStatus) as string[]).includes(value);
}

/** Readable status text; an unknown code is shown as it is. */
export function statusLabel(status: string): string {
  return isStatus(status) ? STATUS_LABELS[status] : status;
}

export function parseTab(id: string): DonorDonationTab | null {
  return donorDonationTabs.find((tab) => tab === id) ?? null;
}

/** The four tabs; counts are left out until the first answer arrives. */
export function buildTabs(counts: DonorDonationTabCounts | null): TabItem[] {
  return donorDonationTabs.map((id) =>
    counts === null
      ? { id, label: TAB_LABELS[id] }
      : { id, label: TAB_LABELS[id], count: counts[COUNT_KEY[id]] },
  );
}

/** Status filter choices for one tab; the empty value means "no filter". */
export function statusOptions(tab: DonorDonationTab): { value: string; label: string }[] {
  return [
    { value: "", label: "All" },
    ...DONOR_DONATION_TAB_STATUSES[tab].map((status) => ({
      value: status,
      label: STATUS_LABELS[status],
    })),
  ];
}

export function statusBelongsToTab(tab: DonorDonationTab, status: string): boolean {
  return status === "" || (DONOR_DONATION_TAB_STATUSES[tab] as readonly string[]).includes(status);
}

/** At least 1, so the pager never gets zero pages. */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize < 1) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Query string for GET /api/donor/donations (no leading "?"). */
export function buildListQuery(input: {
  tab: DonorDonationTab;
  search: string;
  status: string;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  params.set("tab", input.tab);
  const q = input.search.trim().slice(0, SEARCH_MAX_LENGTH);
  if (q !== "") params.set("q", q);
  // A status from another tab would be a 400, so it is dropped here.
  if (input.status !== "" && statusBelongsToTab(input.tab, input.status)) {
    params.set("status", input.status);
  }
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  return params.toString();
}

/** "Showing 1–20 of 24 active donations". */
export function summaryText(input: {
  tab: DonorDonationTab;
  page: number;
  pageSize: number;
  total: number;
  itemCount: number;
}): string {
  const word = TAB_WORDS[input.tab];
  if (input.total === 0) return `0 ${word} donations`;
  const noun = input.total === 1 ? "donation" : "donations";
  // A page past the end is an empty list with the true total.
  if (input.itemCount === 0) return `Showing 0 of ${input.total} ${word} ${noun}`;
  const first = (input.page - 1) * input.pageSize + 1;
  const last = first + input.itemCount - 1;
  const range = first === last ? `${first}` : `${first}–${last}`;
  return `Showing ${range} of ${input.total} ${word} ${noun}`;
}

export function emptyState(
  tab: DonorDonationTab,
  filtered: boolean,
): { title: string; description: string } {
  if (filtered) {
    return {
      title: "No matching donations",
      description: "Try a different search or status.",
    };
  }
  return EMPTY_TEXT[tab];
}

function isDraftStatus(status: string): boolean {
  return status === DonationStatus.DRAFT || status === DonationStatus.SCREENED;
}

export function mapRow(item: DonationListItemJson, timeZone?: string): DonationRowView {
  const pickupText =
    item.pickupStart !== null && item.pickupEnd !== null
      ? formatWindow(item.pickupStart, item.pickupEnd, timeZone)
      : null;
  return {
    id: item.donationId,
    code: `#${item.shortCode.replace(/^#/, "")}`,
    name: item.foodName,
    category: item.category,
    portions: item.portions,
    status: statusLabel(item.status),
    pickup: pickupText ?? DASH,
    // Only drafts have a target page so far (p13 is not built).
    action: isDraftStatus(item.status)
      ? {
          label: "Resume draft",
          href: `/donor/donate?draft=${encodeURIComponent(item.donationId)}`,
        }
      : null,
  };
}

const itemSchema = z.object({
  donationId: z.string(),
  shortCode: z.string(),
  foodName: z.string(),
  category: z.string(),
  portions: z.number(),
  status: z.string(),
  pickupStart: z.string().nullable(),
  pickupEnd: z.string().nullable(),
  updatedAt: z.string(),
  checklistComplete: z.boolean(),
});

const count = z.number().int().min(0);

const responseSchema = z.object({
  tab: z.enum(donorDonationTabs),
  items: z.array(itemSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: count,
  counts: z.object({ drafts: count, active: count, completed: count, notCompleted: count }),
});

export type DonationListResponseJson = z.infer<typeof responseSchema>;

/** The list answer if it has the expected shape, otherwise null. */
export function parseListResponse(body: unknown): DonationListResponseJson | null {
  const parsed = responseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Cards under the table: the newest draft and the newest not completed donation. */
export function buildHighlights(
  draft: DonationListItemJson | null,
  notCompleted: DonationListItemJson | null,
  timeZone?: string,
): HighlightCardView[] {
  const cards: HighlightCardView[] = [];
  if (draft !== null) {
    const saved = formatDateTime(draft.updatedAt, timeZone);
    const checklist = draft.checklistComplete
      ? "Safety checklist complete"
      : "Safety checklist incomplete";
    const action = mapRow(draft, timeZone).action;
    cards.push({
      label: "Drafts",
      tone: "default",
      title: draft.foodName,
      text: saved === null ? checklist : checklist + " · Saved " + saved,
      // Delete draft is not built yet, so only Resume draft is offered.
      actions: action === null ? [] : [{ label: action.label, href: action.href, arrow: true }],
    });
  }
  if (notCompleted !== null) {
    const row = mapRow(notCompleted, timeZone);
    cards.push({
      label: "Not completed",
      tone: "error",
      title: row.code + " · " + row.status,
      text: notCompleted.foodName,
      // View reason and Donate again wait for p13.
      actions: [],
    });
  }
  return cards;
}
