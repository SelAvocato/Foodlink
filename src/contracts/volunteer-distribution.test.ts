import { describe, expect, it } from "vitest";
import {
  GroupServed,
  UnusableReason,
  createDistributionEntrySchema,
  groupServedFromDbCode,
  progressFromTotals,
  reconciliationProgress,
  updateDistributionEntrySchema,
  unusableReasonFromDbCode,
  placePrivacyIssue,
} from "./volunteer-distribution";

function create(overrides: Record<string, unknown> = {}) {
  return createDistributionEntrySchema.safeParse({
    date: "2026-11-18",
    place: "Barangay hall, Commonwealth",
    groupServed: GroupServed.FAMILIES,
    peopleServed: 30,
    portionsDistributed: 12,
    portionsUnusable: 0,
    ...overrides,
  });
}

describe("createDistributionEntrySchema", () => {
  it("accepts a complete entry", () => {
    expect(create()).toMatchObject({
      success: true,
      data: {
        date: "2026-11-18",
        place: "Barangay hall, Commonwealth",
        groupServed: "families",
        peopleServed: 30,
        portionsDistributed: 12,
        portionsUnusable: 0,
      },
    });
  });

  it("refuses zero distributed portions and zero people served", () => {
    expect(create({ portionsDistributed: 0, portionsUnusable: 0 }).success).toBe(false);
    expect(create({ peopleServed: 0 }).success).toBe(false);
  });

  it.each([-1, 0, 1.5, "12", null])("refuses an invalid distributed count %s", (value) => {
    expect(create({ portionsDistributed: value }).success).toBe(false);
  });

  it.each([-1, 1.5, "0", null])("refuses an invalid unusable count %s", (value) => {
    expect(create({ portionsUnusable: value, unusableReason: "damaged" }).success).toBe(false);
  });

  it("refuses a non-calendar date", () => {
    expect(create({ date: "18-11-2026" }).success).toBe(false);
    expect(create({ date: "2026-02-31" }).success).toBe(false);
  });

  it("strips markup from the place and notes", () => {
    const parsed = create({
      place: "<b>Barangay</b> hall",
      notes: "  <script>alert(1)</script> Served after lunch  ",
    });
    expect(parsed.success && parsed.data.place).toBe("bBarangay/b hall");
    expect(parsed.success && parsed.data.notes).toBe("scriptalert(1)/script Served after lunch");
  });

  it("refuses a home address or an individual beneficiary name", () => {
    expect(create({ place: "House of Maria Santos" }).success).toBe(false);
    expect(create({ place: "Unit 4, Sunshine Apartments" }).success).toBe(false);
    expect(create({ place: "Deliver to Mrs. Cruz" }).success).toBe(false);
    expect(placePrivacyIssue("Covered court, Holy Spirit")).toBeNull();
  });

  it("requires a reason when portions are unusable", () => {
    expect(create({ portionsUnusable: 2 }).success).toBe(false);
    expect(
      create({ portionsUnusable: 2, unusableReason: UnusableReason.DAMAGED }).success,
    ).toBe(true);
  });

  it("refuses a reason when no portions are unusable", () => {
    expect(
      create({ portionsUnusable: 0, unusableReason: UnusableReason.DAMAGED }).success,
    ).toBe(false);
  });

  it("requires notes for the other unusable reason", () => {
    expect(
      create({ portionsUnusable: 1, unusableReason: UnusableReason.OTHER }).success,
    ).toBe(false);
    expect(
      create({
        portionsUnusable: 1,
        unusableReason: UnusableReason.OTHER,
        notes: "The tray tipped over.",
      }).success,
    ).toBe(true);
  });

  it("refuses unknown fields", () => {
    expect(create({ volunteerId: "x" }).success).toBe(false);
  });
});

describe("updateDistributionEntrySchema", () => {
  it("accepts a partial update", () => {
    expect(updateDistributionEntrySchema.safeParse({ portionsDistributed: 4 }).success).toBe(
      true,
    );
  });

  it("refuses an empty update", () => {
    expect(updateDistributionEntrySchema.safeParse({}).success).toBe(false);
  });

  it("refuses a reason with zero unusable portions in the same body", () => {
    expect(
      updateDistributionEntrySchema.safeParse({
        portionsUnusable: 0,
        unusableReason: "damaged",
      }).success,
    ).toBe(false);
  });

  it("does not require repeating the stored reason or notes in a partial patch", () => {
    expect(updateDistributionEntrySchema.safeParse({ portionsUnusable: 3 }).success).toBe(true);
    expect(
      updateDistributionEntrySchema.safeParse({ unusableReason: "other" }).success,
    ).toBe(true);
  });

  it("refuses unknown fields", () => {
    expect(updateDistributionEntrySchema.safeParse({ id: "x" }).success).toBe(false);
  });
});

describe("enum mapping", () => {
  it("maps lower-case group and reason values to the database codes", () => {
    expect(groupServedFromDbCode("PERSONS_WITH_DISABILITIES")).toBe(
      "persons_with_disabilities",
    );
    expect(groupServedFromDbCode("UNKNOWN")).toBeNull();
    expect(unusableReasonFromDbCode("SPOILED_ON_ARRIVAL")).toBe("spoiled_on_arrival");
    expect(unusableReasonFromDbCode("UNKNOWN")).toBeNull();
  });
});

describe("progress helpers", () => {
  it("adds distributed and unusable portions", () => {
    expect(progressFromTotals(20, 12, 2)).toEqual({
      accountedPortions: 14,
      totalPortions: 20,
      remainingPortions: 6,
    });
  });

  it("reconciles a list of entries", () => {
    expect(
      reconciliationProgress(20, [
        { portionsDistributed: 8, portionsUnusable: 2 },
        { portionsDistributed: 10, portionsUnusable: 0 },
      ]),
    ).toEqual({ accountedPortions: 20, totalPortions: 20, remainingPortions: 0 });
  });
});
