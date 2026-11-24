import type { DonationStatus } from "./enums";
import type { DistributionEntryView } from "./volunteer-distribution";

export type DistributionUnit = "portions";

export type DistributionSummary = {
  id: string;
  referenceCode: string;
  status: DonationStatus;
  totalQuantity: number;
  unit: DistributionUnit;
  distributedQuantity: number;
  unusableQuantity: number;
  remainingQuantity: number;
  entryCount: number;
  canAddEntry: boolean;
  canComplete: boolean;
};

export type DistributionEntriesResponse = {
  summary: DistributionSummary;
  entries: DistributionEntryView[];
};
