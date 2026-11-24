import type { DistributionSummary, DistributionUnit } from "@/contracts/distribution";
import { DonationStatus } from "@/contracts/enums";
import type { DistributionViewerRole } from "./access";

const REFERENCE_CODE_LENGTH = 8;
const DISTRIBUTION_UNIT: DistributionUnit = "portions";

export function distributionReferenceCode(donationId: string): string {
  return `#${donationId.slice(0, REFERENCE_CODE_LENGTH).toUpperCase()}`;
}

export type DistributionAccountingInput = {
  totalQuantity: number;
  distributedQuantity: number;
  unusableQuantity: number;
};

export type DistributionAccounting = {
  totalQuantity: number;
  distributedQuantity: number;
  unusableQuantity: number;
  remainingQuantity: number;
};

export function computeDistributionAccounting(
  input: DistributionAccountingInput,
): DistributionAccounting {
  return {
    totalQuantity: input.totalQuantity,
    distributedQuantity: input.distributedQuantity,
    unusableQuantity: input.unusableQuantity,
    remainingQuantity:
      input.totalQuantity - input.distributedQuantity - input.unusableQuantity,
  };
}

export type DistributionSummaryInput = {
  donationId: string;
  status: DonationStatus;
  totalQuantity: number;
  distributedQuantity: number;
  unusableQuantity: number;
  entryCount: number;
  viewerRole: DistributionViewerRole;
  isAssignedVolunteer: boolean;
};

export function computeDistributionSummary(
  input: DistributionSummaryInput,
): DistributionSummary {
  const accounting = computeDistributionAccounting(input);
  const isDelivered = input.status === DonationStatus.DELIVERED;
  const isAssignedVolunteer =
    input.viewerRole === "VOLUNTEER" && input.isAssignedVolunteer;

  return {
    id: input.donationId,
    referenceCode: distributionReferenceCode(input.donationId),
    status: input.status,
    totalQuantity: accounting.totalQuantity,
    unit: DISTRIBUTION_UNIT,
    distributedQuantity: accounting.distributedQuantity,
    unusableQuantity: accounting.unusableQuantity,
    remainingQuantity: accounting.remainingQuantity,
    entryCount: input.entryCount,
    canAddEntry:
      isAssignedVolunteer && isDelivered && accounting.remainingQuantity > 0,
    canComplete:
      isAssignedVolunteer &&
      isDelivered &&
      input.entryCount > 0 &&
      accounting.remainingQuantity === 0,
  };
}
