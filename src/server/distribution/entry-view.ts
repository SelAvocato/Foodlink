import {
  groupServedFromDbCode,
  unusableReasonFromDbCode,
  type DistributionEntryView,
} from "@/contracts/volunteer-distribution";

export type DistributionEntryRow = {
  id: string;
  distributedOn: string;
  place: string;
  groupCode: string;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReasonCode: string | null;
  notes: string | null;
};

/**
 * Serializes a distribution entry row into the allow-listed view. Only these
 * fields leave the server; storage paths and beneficiary-identifying data are
 * never part of the row. Distribution photos are not implemented yet.
 *
 * TODO: refactor prisma-distribution-entry-store.ts to use this serializer once
 * the write store is next touched.
 */
export function toDistributionEntryView(
  row: DistributionEntryRow,
): DistributionEntryView {
  const groupServed = groupServedFromDbCode(row.groupCode);
  if (!groupServed) {
    throw new Error(`Unknown beneficiary group code: ${row.groupCode}`);
  }

  const unusableReason = row.unusableReasonCode
    ? unusableReasonFromDbCode(row.unusableReasonCode)
    : null;
  if (row.unusableReasonCode && !unusableReason) {
    throw new Error(`Unknown unusable reason: ${row.unusableReasonCode}`);
  }

  return {
    id: row.id,
    date: row.distributedOn,
    place: row.place,
    groupServed,
    peopleServed: row.peopleServed,
    portionsDistributed: row.portionsDistributed,
    portionsUnusable: row.portionsUnusable,
    unusableReason,
    notes: row.notes,
  };
}
