import { describe, expect, it } from "vitest";
import type { ChecklistView } from "./checklist-logic";
import type { PickupDetails } from "./details-logic";
import {
  formatDateTime,
  formatWindow,
  pickupLines,
  safetyLines,
  summaryLine,
} from "./review-logic";

// Every date check passes its own zone, so no test depends on the machine's.
const UTC = "UTC";
const MANILA = "Asia/Manila";

function checklist(overrides: Partial<ChecklistView> = {}): ChecklistView {
  return {
    preparedAt: "2026-11-04T01:00:00.000Z",
    consumeByAt: "2026-11-04T10:00:00.000Z",
    storageCondition: null,
    storageTemperatureC: null,
    packagingIntact: true,
    allergensConfirmed: true,
    notCustomerPlateLeftovers: true,
    ...overrides,
  };
}

function pickup(overrides: Partial<PickupDetails> = {}): PickupDetails {
  return {
    address: {
      streetLine1: "18 Mabini Street",
      streetLine2: null,
      barangay: "Barangay Central",
      city: "Quezon City",
      provinceOrState: null,
      postalCode: null,
      countryCode: "PH",
      latitude: null,
      longitude: null,
    },
    pickupStart: "2026-11-04T07:00:00.000Z",
    pickupEnd: "2026-11-04T09:00:00.000Z",
    ...overrides,
  };
}

describe("formatDateTime", () => {
  it("formats day, month, year and a 12-hour clock in the given zone", () => {
    expect(formatDateTime("2026-11-04T01:00:00.000Z", UTC)).toBe("4 Nov 2026, 1:00 AM");
    expect(formatDateTime("2026-11-04T01:00:00.000Z", MANILA)).toBe("4 Nov 2026, 9:00 AM");
  });

  it("returns null for an unreadable date", () => {
    expect(formatDateTime("not a date", UTC)).toBeNull();
  });
});

describe("formatWindow", () => {
  it("shares the period when both ends are in the same one", () => {
    expect(formatWindow("2026-11-04T07:00:00.000Z", "2026-11-04T09:00:00.000Z", UTC)).toBe(
      "4 Nov 2026 · 7:00–9:00 AM",
    );
  });

  it("repeats the period when the window crosses noon", () => {
    expect(formatWindow("2026-11-04T11:00:00.000Z", "2026-11-04T13:00:00.000Z", UTC)).toBe(
      "4 Nov 2026 · 11:00 AM–1:00 PM",
    );
  });

  it("shows both dates when the window crosses midnight", () => {
    expect(formatWindow("2026-11-04T22:00:00.000Z", "2026-11-05T01:00:00.000Z", UTC)).toBe(
      "4 Nov 2026, 10:00 PM – 5 Nov 2026, 1:00 AM",
    );
  });

  it("decides the day in the given zone, not in UTC", () => {
    expect(formatWindow("2026-11-04T06:00:00.000Z", "2026-11-04T08:00:00.000Z", MANILA)).toBe(
      "4 Nov 2026 · 2:00–4:00 PM",
    );
  });

  it("returns null when either end is unreadable", () => {
    expect(formatWindow("bad", "2026-11-04T09:00:00.000Z", UTC)).toBeNull();
    expect(formatWindow("2026-11-04T07:00:00.000Z", "bad", UTC)).toBeNull();
  });
});

describe("summaryLine", () => {
  it("joins portions, category and donor label", () => {
    expect(
      summaryLine({ portions: 24, categoryName: "Bakery", donorLabel: "Establishment donor" }),
    ).toBe("24 portions · Bakery · Establishment donor");
  });

  it("uses the singular for one portion", () => {
    expect(summaryLine({ portions: 1, categoryName: "Cooked meals", donorLabel: "Donor" })).toBe(
      "1 portion · Cooked meals · Donor",
    );
  });
});

describe("safetyLines", () => {
  it("lists screening, prepared, consume-by, allergens and packaging", () => {
    expect(
      safetyLines({
        checklist: checklist(),
        requiresPreparedTime: true,
        allergenNames: ["Wheat / gluten", "Milk"],
        timeZone: UTC,
      }),
    ).toEqual([
      "Visual screening: Passed",
      "Prepared: 4 Nov 2026, 1:00 AM",
      "Consume by: 4 Nov 2026, 10:00 AM",
      "Allergens: Wheat / gluten, Milk",
      "Packaging clean · No opened food or leftovers",
    ]);
  });

  it("leaves the prepared line out when the category does not ask for it", () => {
    const lines = safetyLines({
      checklist: checklist(),
      requiresPreparedTime: false,
      allergenNames: [],
      timeZone: UTC,
    });
    expect(lines.some((line) => line.startsWith("Prepared"))).toBe(false);
  });

  it("says None declared for an empty allergen list", () => {
    const lines = safetyLines({
      checklist: checklist(),
      requiresPreparedTime: false,
      allergenNames: [],
      timeZone: UTC,
    });
    expect(lines).toContain("Allergens: None declared");
  });

  it("leaves the packaging line out unless both confirmations are true", () => {
    for (const overrides of [
      { packagingIntact: false },
      { packagingIntact: null },
      { notCustomerPlateLeftovers: false },
      { notCustomerPlateLeftovers: null },
    ]) {
      const lines = safetyLines({
        checklist: checklist(overrides),
        requiresPreparedTime: false,
        allergenNames: [],
        timeZone: UTC,
      });
      expect(lines.some((line) => line.startsWith("Packaging"))).toBe(false);
    }
  });

  it("skips a consume-by that is missing or unreadable", () => {
    for (const consumeByAt of [null, "bad"]) {
      const lines = safetyLines({
        checklist: checklist({ consumeByAt }),
        requiresPreparedTime: false,
        allergenNames: [],
        timeZone: UTC,
      });
      expect(lines.some((line) => line.startsWith("Consume by"))).toBe(false);
    }
  });
});

describe("pickupLines", () => {
  it("lists the window, street with barangay, and the city", () => {
    expect(pickupLines(pickup(), UTC)).toEqual([
      "4 Nov 2026 · 7:00–9:00 AM",
      "18 Mabini Street, Barangay Central",
      "Quezon City",
    ]);
  });

  it("includes street line 2 and skips empty parts", () => {
    const base = pickup();
    const lines = pickupLines(
      pickup({ address: { ...base.address, streetLine2: " Unit 4 ", barangay: "  " } }),
      UTC,
    );
    expect(lines[1]).toBe("18 Mabini Street, Unit 4");
  });

  it("leaves out an unreadable window", () => {
    const lines = pickupLines(pickup({ pickupStart: "bad" }), UTC);
    expect(lines).toEqual(["18 Mabini Street, Barangay Central", "Quezon City"]);
  });
});
