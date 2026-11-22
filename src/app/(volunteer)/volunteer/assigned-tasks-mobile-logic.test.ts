import { describe, expect, it } from "vitest";
import type { TaskItem } from "./assigned-tasks-logic";
import { cardLabel, mobileDateLine, portionsText } from "./assigned-tasks-mobile-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";
const NOW = new Date(2026, 5, 15, 12, 0, 0); // 15 June 2026, local time

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    donationId: DONATION_ID,
    shortCode: "9FC03951",
    foodName: "Rice bowls",
    category: "Prepared food",
    portions: 12,
    status: "ASSIGNED",
    pickupAddress: "18 Mabini Street, Barangay Central",
    pickupStart: "2026-06-15T08:00:00.000Z",
    pickupEnd: "2026-06-15T10:00:00.000Z",
    donorName: "Test Donor",
    donorPhone: "+63 900 000 0000",
    ...overrides,
  };
}

/** An ISO instant this many milliseconds after NOW; keeps the tests local-time safe. */
function endIn(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

describe("mobileDateLine", () => {
  it("writes the weekday, day and month from the local calendar", () => {
    expect(mobileDateLine(new Date(2026, 10, 4))).toBe("Wednesday, 4 November");
  });

  it("does not pad a single-digit day", () => {
    expect(mobileDateLine(new Date(2026, 0, 1))).toBe("Thursday, 1 January");
  });
});

describe("portionsText", () => {
  it("uses the singular for one portion", () => {
    expect(portionsText(1)).toBe("1 portion");
  });

  it("uses the plural for every other count", () => {
    expect(portionsText(2)).toBe("2 portions");
    expect(portionsText(0)).toBe("0 portions");
  });
});

describe("cardLabel", () => {
  it("counts down hours and minutes for an assigned task", () => {
    const end = endIn(2 * 60 * 60 * 1000 + 15 * 60 * 1000);
    expect(cardLabel(item({ pickupEnd: end }), NOW)).toBe("PICKUP · ENDS IN 2H 15M");
  });

  it("reads exactly one hour as 1H 0M", () => {
    expect(cardLabel(item({ pickupEnd: endIn(60 * 60 * 1000) }), NOW)).toBe(
      "PICKUP · ENDS IN 1H 0M",
    );
  });

  it("floors partial minutes", () => {
    const end = endIn(2 * 60 * 60 * 1000 + 15 * 60 * 1000 + 59 * 1000);
    expect(cardLabel(item({ pickupEnd: end }), NOW)).toBe("PICKUP · ENDS IN 2H 15M");
  });

  it("uses minutes under one hour", () => {
    expect(cardLabel(item({ pickupEnd: endIn(45 * 60 * 1000) }), NOW)).toBe(
      "PICKUP · ENDS IN 45M",
    );
    expect(cardLabel(item({ pickupEnd: endIn(60 * 1000) }), NOW)).toBe("PICKUP · ENDS IN 1M");
  });

  it("reads less than a minute when the window has under 60 seconds left", () => {
    expect(cardLabel(item({ pickupEnd: endIn(59 * 1000) }), NOW)).toBe(
      "PICKUP · LESS THAN 1M",
    );
  });

  it("says the window ended at exactly zero or in the past", () => {
    expect(cardLabel(item({ pickupEnd: endIn(0) }), NOW)).toBe("PICKUP · WINDOW ENDED");
    expect(cardLabel(item({ pickupEnd: endIn(-1000) }), NOW)).toBe("PICKUP · WINDOW ENDED");
  });

  it("falls back to PICKUP for a missing or unreadable end", () => {
    expect(cardLabel(item({ pickupEnd: null }), NOW)).toBe("PICKUP");
    expect(cardLabel(item({ pickupEnd: "not-a-date" }), NOW)).toBe("PICKUP");
  });

  it("labels a picked-up task", () => {
    expect(cardLabel(item({ status: "PICKED_UP" }), NOW)).toBe("PICKED UP");
  });

  it("labels a delivered task with the unfinished report", () => {
    expect(cardLabel(item({ status: "DELIVERED" }), NOW)).toBe(
      "DELIVERED · REPORT INCOMPLETE",
    );
  });
});
