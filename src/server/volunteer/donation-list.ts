import {
  VOLUNTEER_DONATION_STATUSES,
  type VolunteerDonationListItem,
  type VolunteerDonationListQuery,
  type VolunteerDonationListResponse,
  type VolunteerDonationListRow,
  type VolunteerDonationStatus,
} from "@/contracts/volunteer-donation-list";

export interface VolunteerDonationListPage {
  volunteerId: string;
  statuses: readonly VolunteerDonationStatus[];
  limit: number;
  offset: number;
}

export interface VolunteerDonationListStore {
  findPage(
    input: VolunteerDonationListPage,
  ): Promise<{ rows: VolunteerDonationListRow[]; total: number }>;
}

const SHORT_CODE_LENGTH = 8;

export async function getVolunteerDonationList(
  deps: { store: VolunteerDonationListStore },
  input: { volunteerId: string; query: VolunteerDonationListQuery },
): Promise<VolunteerDonationListResponse> {
  const { volunteerId, query } = input;
  const statuses = query.status === undefined ? VOLUNTEER_DONATION_STATUSES : [query.status];
  const offset = (query.page - 1) * query.pageSize;

  const { rows, total } = await deps.store.findPage({
    volunteerId,
    statuses,
    limit: query.pageSize,
    offset,
  });

  const items: VolunteerDonationListItem[] = rows.map((row) => ({
    donationId: row.donationId,
    shortCode: row.donationId.slice(0, SHORT_CODE_LENGTH).toUpperCase(),
    foodName: row.foodName,
    category: row.category,
    portions: row.portions,
    status: row.status,
    pickupAddress: row.pickupAddress,
    pickupStart: row.pickupStart,
    pickupEnd: row.pickupEnd,
    donorName: row.donorName,
    donorPhone: row.donorPhone,
  }));

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}
