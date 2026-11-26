import { describe, expect, test } from "vitest";
import {
  createDistributionEntryInputSchema,
  overLimitMessage,
  updateDistributionEntryInputSchema,
} from "./schema";

describe("distribution entry schema", () => {
  test("over-limit message", () => {
    expect(overLimitMessage(120, 100)).toBe(
      "120 of 100 is not allowed. Running totals cannot exceed 100.",
    );
  });

  test("create: valid entry passes", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 30,
      portionsDistributed: 40,
      portionsUnusable: 5,
      unusableReason: "damaged",
      notes: "Packaging torn",
    });
    expect(result.success).toBe(true);
  });

  test("create: unusable > 0 requires reason", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 30,
      portionsDistributed: 40,
      portionsUnusable: 5,
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.unusableReason).toContain(
      "Choose why the portions were unusable",
    );
  });

  test("create: unusable = 0 omits reason", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 30,
      portionsDistributed: 40,
      portionsUnusable: 0,
      unusableReason: "damaged",
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.unusableReason).toContain(
      "Only add an unusable reason when portions are unusable",
    );
  });

  test("create: reason other requires notes", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 30,
      portionsDistributed: 40,
      portionsUnusable: 5,
      unusableReason: "other",
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.notes).toContain(
      "Describe what happened when the unusable reason is other",
    );
  });

  test("create: peopleServed must be >= 1", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 0,
      portionsDistributed: 1,
      portionsUnusable: 0,
    });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.peopleServed).toContain(
      "People served must be at least 1",
    );
  });

  test("create: default portionsUnusable is 0", () => {
    const result = createDistributionEntryInputSchema.safeParse({
      date: "2026-11-25",
      place: "Barangay Hall",
      groupServed: "families",
      peopleServed: 30,
      portionsDistributed: 40,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portionsUnusable).toBe(0);
  });

  test("update: partial with one field passes", () => {
    const result = updateDistributionEntryInputSchema.safeParse({
      place: "Covered Court",
    });
    expect(result.success).toBe(true);
  });

  test("update: empty body is rejected", () => {
    const result = updateDistributionEntryInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
