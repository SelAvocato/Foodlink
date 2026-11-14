import { z } from "zod";
import { DonationStatus } from "./enums";

/** The four tabs on "My donations" (Figma p12). */
export const donorDonationTabs = ["drafts", "active", "completed", "not_completed"] as const;
export type DonorDonationTab = (typeof donorDonationTabs)[number];

/**
 * One constant per tab, built from the DonationStatus enum. SCREENED sits under
 * Drafts because the donor can still edit it, and DELIVERED sits under Active
 * because the volunteer has not closed the donation yet. A contract test pins
 * that every status belongs to exactly one tab, so a new status cannot be forgotten.
 */
export const DONOR_DONATION_TAB_STATUSES: Readonly<
  Record<DonorDonationTab, readonly DonationStatus[]>
> = {
  drafts: [DonationStatus.DRAFT, DonationStatus.SCREENED],
  active: [
    DonationStatus.POSTED,
    DonationStatus.ACCEPTED,
    DonationStatus.ASSIGNED,
    DonationStatus.PICKED_UP,
    DonationStatus.DELIVERED,
  ],
  completed: [DonationStatus.CLOSED],
  not_completed: [
    DonationStatus.REJECTED,
    DonationStatus.DECLINED,
    DonationStatus.REJECTED_AT_PICKUP,
    DonationStatus.CANCELLED,
    DonationStatus.EXPIRED,
  ],
};

/**
 * Search text for the food name or the donation id. It is trimmed, a leading "#"
 * is removed (the screen shows the short code with one), and blank becomes
 * undefined. The 100-character limit applies to the cleaned text.
 */
const donorDonationSearch = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#/, "").trim())
  .refine((value) => value.length <= 100, "Use at most 100 characters")
  .transform((value) => (value === "" ? undefined : value));

/**
 * The list query string (the route parses searchParams, so every value arrives as
 * text). Strict, because donor id, address, QR token and page totals are never
 * client input. A status must belong to the chosen tab.
 */
export const donorDonationListQuerySchema = z
  .strictObject({
    tab: z.enum(donorDonationTabs).default("active"),
    q: donorDonationSearch.optional(),
    status: z.enum(DonationStatus).optional(),
    page: z.coerce
      .number()
      .int("The page must be a whole number")
      .min(1, "Use page 1 or higher")
      .max(10000, "Use page 10000 or lower")
      .default(1),
    pageSize: z.coerce
      .number()
      .int("The page size must be a whole number")
      .min(1, "Use at least 1")
      .max(50, "Use at most 50")
      .default(20),
  })
  .refine(
    (query) =>
      query.status === undefined || DONOR_DONATION_TAB_STATUSES[query.tab].includes(query.status),
    { message: "The status does not belong to the selected tab", path: ["status"] },
  );
export type DonorDonationListQuery = z.infer<typeof donorDonationListQuerySchema>;

/**
 * One row on the list. Only these fields leave the server: never the donor id, an
 * address id or text, the QR token, the description, a storage key, an exit reason
 * or a note of any kind. The donor reads those on the detail screen (p13).
 */
export type DonorDonationListItem = {
  donationId: string;
  /** Derived from the donation id: the schema has no display-code column. */
  shortCode: string;
  foodName: string;
  /** The food_categories name. */
  category: string;
  portions: number;
  status: DonationStatus;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  updatedAt: Date;
  checklistComplete: boolean;
};

/** What the store returns: the same row without the derived short code. */
export type DonorDonationListRow = Omit<DonorDonationListItem, "shortCode">;

export type DonorDonationTabCounts = {
  drafts: number;
  active: number;
  completed: number;
  notCompleted: number;
};

export type DonorDonationListResponse = {
  tab: DonorDonationTab;
  items: DonorDonationListItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: DonorDonationTabCounts;
};
