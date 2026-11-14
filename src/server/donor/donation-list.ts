import {
  DONOR_DONATION_TAB_STATUSES,
  type DonorDonationListItem,
  type DonorDonationListQuery,
  type DonorDonationListResponse,
  type DonorDonationListRow,
  type DonorDonationTabCounts,
} from "@/contracts/donor-donation-list";
import type { DonationStatus } from "@/contracts/enums";

export interface DonorDonationListPage {
  donorId: string;
  /** The tab's statuses, or the single status from the status filter. */
  statuses: readonly DonationStatus[];
  /** Already cleaned by the contract: trimmed, no leading "#", undefined when blank. */
  q: string | undefined;
  limit: number;
  offset: number;
}

export interface DonorDonationListStore {
  /** One page of the donor's own non-deleted donations, plus the total matching the same filter. */
  findPage(input: DonorDonationListPage): Promise<{ rows: DonorDonationListRow[]; total: number }>;
  /** The four tab counts over the donor's non-deleted donations, ignoring search and status. */
  countByTab(donorId: string): Promise<DonorDonationTabCounts>;
}

/** The schema has no display-code column, so the short code is derived from the id. */
const SHORT_CODE_LENGTH = 8;

/**
 * The donor's own donations for the "My donations" list (Figma p12). The donor id
 * comes from the session, never from the query string. A status filter replaces the
 * tab's statuses, so the response can hold a subset of the tab. A page past the end
 * is an empty list with the true total, not an error. The counts always describe the
 * whole tab, whatever the search and status filter say.
 */
export async function getDonorDonationList(
  deps: { store: DonorDonationListStore },
  input: { donorId: string; query: DonorDonationListQuery },
): Promise<DonorDonationListResponse> {
  const { donorId, query } = input;
  const statuses =
    query.status === undefined ? DONOR_DONATION_TAB_STATUSES[query.tab] : [query.status];
  const offset = (query.page - 1) * query.pageSize;

  const [{ rows, total }, counts] = await Promise.all([
    deps.store.findPage({
      donorId,
      statuses,
      q: query.q,
      limit: query.pageSize,
      offset,
    }),
    deps.store.countByTab(donorId),
  ]);

  const items: DonorDonationListItem[] = rows.map((row) => ({
    donationId: row.donationId,
    shortCode: row.donationId.slice(0, SHORT_CODE_LENGTH).toUpperCase(),
    foodName: row.foodName,
    category: row.category,
    portions: row.portions,
    status: row.status,
    pickupStart: row.pickupStart,
    pickupEnd: row.pickupEnd,
    updatedAt: row.updatedAt,
    checklistComplete: row.checklistComplete,
  }));

  return {
    tab: query.tab,
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    counts,
  };
}
