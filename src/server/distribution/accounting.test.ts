import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  computeDistributionAccounting,
  computeDistributionSummary,
  distributionReferenceCode,
  type DistributionSummaryInput,
} from "./accounting";

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

function input(
  overrides: Partial<DistributionSummaryInput> = {},
): DistributionSummaryInput {
  return {
    donationId: DONATION_ID,
    status: DonationStatus.DELIVERED,
    totalQuantity: 20,
    distributedQuantity: 0,
    unusableQuantity: 0,
    entryCount: 0,
    viewerRole: "VOLUNTEER",
    isAssignedVolunteer: true,
    ...overrides,
  };
}

describe("distributionReferenceCode", () => {
  it("uses a hash and the first eight characters, uppercased", () => {
    expect(distributionReferenceCode(DONATION_ID)).toBe("#ABCDEF12");
  });
});

describe("computeDistributionAccounting", () => {
  it("returns remaining portions unclamped", () => {
    expect(
      computeDistributionAccounting({
        totalQuantity: 20,
        distributedQuantity: 18,
        unusableQuantity: 5,
      }),
    ).toEqual({
      totalQuantity: 20,
      distributedQuantity: 18,
      unusableQuantity: 5,
      remainingQuantity: -3,
    });
  });
});

describe("computeDistributionSummary", () => {
  it("describes a donation with no entries yet", () => {
    expect(computeDistributionSummary(input())).toEqual({
      id: DONATION_ID,
      referenceCode: "#ABCDEF12",
      status: DonationStatus.DELIVERED,
      totalQuantity: 20,
      unit: "portions",
      distributedQuantity: 0,
      unusableQuantity: 0,
      remainingQuantity: 20,
      entryCount: 0,
      canAddEntry: true,
      canComplete: false,
    });
  });

  it("allows another entry while portions remain", () => {
    const summary = computeDistributionSummary(
      input({
        distributedQuantity: 8,
        unusableQuantity: 2,
        entryCount: 1,
      }),
    );

    expect(summary.remainingQuantity).toBe(10);
    expect(summary.canAddEntry).toBe(true);
    expect(summary.canComplete).toBe(false);
  });

  it("allows completion when distributed plus unusable reconciles", () => {
    const summary = computeDistributionSummary(
      input({
        distributedQuantity: 18,
        unusableQuantity: 2,
        entryCount: 2,
      }),
    );

    expect(summary.remainingQuantity).toBe(0);
    expect(summary.canAddEntry).toBe(false);
    expect(summary.canComplete).toBe(true);
  });

  it("handles unusable-only reconciliation", () => {
    const reconciled = computeDistributionSummary(
      input({
        distributedQuantity: 0,
        unusableQuantity: 20,
        entryCount: 1,
      }),
    );

    expect(reconciled.remainingQuantity).toBe(0);
    expect(reconciled.canAddEntry).toBe(false);
    expect(reconciled.canComplete).toBe(true);

    const withoutEntry = computeDistributionSummary(
      input({
        distributedQuantity: 0,
        unusableQuantity: 20,
        entryCount: 0,
      }),
    );
    expect(withoutEntry.canComplete).toBe(false);
  });

  it("blocks both actions when the remaining quantity is negative", () => {
    const summary = computeDistributionSummary(
      input({
        distributedQuantity: 18,
        unusableQuantity: 5,
        entryCount: 2,
      }),
    );

    expect(summary.remainingQuantity).toBe(-3);
    expect(summary.canAddEntry).toBe(false);
    expect(summary.canComplete).toBe(false);
  });

  it("keeps a CLOSED donation read-only", () => {
    const summary = computeDistributionSummary(
      input({
        status: DonationStatus.CLOSED,
        distributedQuantity: 18,
        unusableQuantity: 2,
        entryCount: 2,
      }),
    );

    expect(summary.status).toBe(DonationStatus.CLOSED);
    expect(summary.canAddEntry).toBe(false);
    expect(summary.canComplete).toBe(false);
  });

  it("never lets an Admin add or complete", () => {
    const summary = computeDistributionSummary(
      input({
        viewerRole: "ADMIN",
        isAssignedVolunteer: true,
        distributedQuantity: 18,
        unusableQuantity: 2,
        entryCount: 2,
      }),
    );

    expect(summary.canAddEntry).toBe(false);
    expect(summary.canComplete).toBe(false);
  });

  it("never lets a Volunteer who is not the current assignee add or complete", () => {
    const summary = computeDistributionSummary(
      input({
        isAssignedVolunteer: false,
        distributedQuantity: 18,
        unusableQuantity: 2,
        entryCount: 2,
      }),
    );

    expect(summary.canAddEntry).toBe(false);
    expect(summary.canComplete).toBe(false);
  });
});
