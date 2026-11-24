// TODO-SWAP: replace with the real GET /api/donations/[id]/distribution-entries
// once it lands on this branch (Task 2 shared distribution GET).
export type DistributionSummary = {
  id: string;
  referenceCode: string;
  status: string;
  totalQuantity: number;
  unit: string;
  distributedQuantity: number;
  unusableQuantity: number;
  remainingQuantity: number;
  entryCount: number;
  canAddEntry: boolean;
  canComplete: boolean;
};

export type DistributionEntryView = {
  id: string;
  date: string;
  place: string;
  groupServed: string;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason: string | null;
  notes: string | null;
};

export type DistributionEntriesResponse = {
  summary: DistributionSummary;
  entries: DistributionEntryView[];
};

export const MOCK_DISTRIBUTION_SUMMARY: DistributionSummary = {
  id: "00000000-0000-0000-0000-000000000001",
  referenceCode: "#FL-0268",
  status: "DELIVERED",
  totalQuantity: 100,
  unit: "portions",
  distributedQuantity: 0,
  unusableQuantity: 0,
  remainingQuantity: 100,
  entryCount: 0,
  canAddEntry: true,
  canComplete: false,
};

export const MOCK_DISTRIBUTION_ENTRIES: DistributionEntryView[] = [];

export async function mockGetDistributionEntries(
  _donationId: string,
): Promise<DistributionEntriesResponse> {
  return {
    summary: MOCK_DISTRIBUTION_SUMMARY,
    entries: MOCK_DISTRIBUTION_ENTRIES,
  };
}
