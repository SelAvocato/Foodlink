import { describe, expect, it } from "vitest";

import { addCalendarMonths, isConsumeByTooSoon, requiresMinShelfLife } from "./min-shelf-life";

const NOW = new Date("2026-11-26T05:00:00.000Z");
const CUTOFF = new Date("2027-04-26T05:00:00.000Z");

describe("requiresMinShelfLife", () => {
  it("covers sealed packaged food and beverages only", () => {
    expect(requiresMinShelfLife("PACKAGED_FOOD")).toBe(true);
    expect(requiresMinShelfLife("BEVERAGES")).toBe(true);
    expect(requiresMinShelfLife("FRESH_PRODUCE")).toBe(false);
    expect(requiresMinShelfLife("COOKED_MEALS")).toBe(false);
    expect(requiresMinShelfLife("BAKERY")).toBe(false);
  });
});

describe("addCalendarMonths", () => {
  it("adds calendar months and keeps the time of day", () => {
    expect(addCalendarMonths(NOW, 5).toISOString()).toBe(CUTOFF.toISOString());
  });

  it("clamps to the end of a shorter month", () => {
    expect(addCalendarMonths(new Date("2026-09-30T00:00:00.000Z"), 5).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(addCalendarMonths(new Date("2027-09-30T00:00:00.000Z"), 5).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });
});

describe("isConsumeByTooSoon", () => {
  it("refuses exactly 5 months and anything sooner", () => {
    expect(isConsumeByTooSoon("PACKAGED_FOOD", CUTOFF, NOW)).toBe(true);
    expect(isConsumeByTooSoon("BEVERAGES", new Date("2027-03-26T05:00:00.000Z"), NOW)).toBe(true);
  });

  it("accepts anything strictly after 5 months", () => {
    expect(isConsumeByTooSoon("PACKAGED_FOOD", new Date(CUTOFF.getTime() + 1), NOW)).toBe(false);
  });

  it("ignores other categories and a missing date", () => {
    expect(isConsumeByTooSoon("FRESH_PRODUCE", new Date("2026-11-27T05:00:00.000Z"), NOW)).toBe(false);
    expect(isConsumeByTooSoon("PACKAGED_FOOD", null, NOW)).toBe(false);
  });
});
