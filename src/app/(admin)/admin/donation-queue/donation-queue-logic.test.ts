import { describe, expect, it } from "vitest";
import {
  NOTICE,
  PAGE_SIZE,
  buildCategoryOptions,
  expiryLabel,
  filterRows,
  pageCount,
  pageSlice,
  parseQueueResponse,
  reportDetail,
  safePage,
  sortByDeadline,
  summaryText,
  transitionFailure,
  validateReason,
  windowLabel,
  type DonationQueueJson,
} from "./donation-queue-logic";

function row(overrides: Partial<DonationQueueJson> = {}): DonationQueueJson {
  return {
    donationId: "11111111-1111-4111-8111-111111111111",
    foodName: "Test bread",
    category: "Bakery",
    portions: 24,
    donorName: "Test Donor",
    donorType: "ESTABLISHMENT",
    pickupAddress: "10 Market Road, Quezon City",
    pickupStart: "2026-11-04T15:00:00.000Z",
    pickupEnd: "2026-11-04T17:00:00.000Z",
    postedAt: "2026-11-03T08:00:00.000Z",
    ...overrides,
  };
}

describe("windowLabel", () => {
  it("writes one line for a window on the same day", () => {
    expect(windowLabel("2026-11-04T15:00:00.000Z", "2026-11-04T17:00:00.000Z", "UTC")).toBe(
      "4 Nov 2026 · 3:00–5:00 PM",
    );
  });

  it("writes both dates when the window crosses midnight", () => {
    expect(windowLabel("2026-11-04T23:00:00.000Z", "2026-11-05T01:00:00.000Z", "UTC")).toBe(
      "4 Nov 2026, 11:00 PM – 5 Nov 2026, 1:00 AM",
    );
  });

  it("shows a dash when either end is missing", () => {
    expect(windowLabel(null, "2026-11-04T17:00:00.000Z", "UTC")).toBe("—");
    expect(windowLabel("2026-11-04T15:00:00.000Z", null, "UTC")).toBe("—");
    expect(windowLabel(null, null, "UTC")).toBe("—");
  });

  it("shows a dash when a date cannot be read", () => {
    expect(windowLabel("not-a-date", "2026-11-04T17:00:00.000Z", "UTC")).toBe("—");
  });

  it("uses the given time zone", () => {
    // 16:00 UTC is 00:00 the next day in Manila.
    expect(windowLabel("2026-11-04T16:00:00.000Z", "2026-11-04T17:00:00.000Z", "Asia/Manila")).toBe(
      "5 Nov 2026 · 12:00–1:00 AM",
    );
  });
});

describe("expiryLabel", () => {
  it("formats the pickup end like the pickup label", () => {
    expect(expiryLabel("2026-11-04T10:00:00.000Z", "UTC")).toBe("4 Nov 2026, 10:00 AM");
  });

  it("shows a dash when the pickup end is missing or unreadable", () => {
    expect(expiryLabel(null, "UTC")).toBe("—");
    expect(expiryLabel("not-a-date", "UTC")).toBe("—");
  });
});

describe("buildCategoryOptions", () => {
  it("starts with All categories and lists each loaded category once, sorted", () => {
    const rows = [
      row({ category: "Fresh produce" }),
      row({ category: "Bakery" }),
      row({ category: "Bakery" }),
    ];
    expect(buildCategoryOptions(rows)).toEqual([
      { value: "all", label: "All categories" },
      { value: "Bakery", label: "Bakery" },
      { value: "Fresh produce", label: "Fresh produce" },
    ]);
  });

  it("offers only All categories for an empty queue", () => {
    expect(buildCategoryOptions([])).toEqual([{ value: "all", label: "All categories" }]);
  });
});

describe("filterRows", () => {
  const rows = [
    row({ donationId: "a", foodName: "Banana bread", donorName: "Test Donor", category: "Bakery" }),
    row({
      donationId: "b",
      foodName: "Whole vegetables",
      donorName: "Central Produce Stall",
      category: "Fresh produce",
    }),
    row({
      donationId: "c",
      foodName: "Pan de sal",
      donorName: "Green Table",
      category: "Bakery",
    }),
  ];

  it("matches the food name, case-insensitively", () => {
    expect(filterRows(rows, { query: "BREAD", category: "all" }).map((r) => r.donationId)).toEqual([
      "a",
    ]);
  });

  it("matches the donor name, case-insensitively", () => {
    expect(
      filterRows(rows, { query: "green table", category: "all" }).map((r) => r.donationId),
    ).toEqual(["c"]);
  });

  it("trims the search and treats it as no filter when blank", () => {
    expect(filterRows(rows, { query: "  pan  ", category: "all" })).toHaveLength(1);
    expect(filterRows(rows, { query: "   ", category: "all" })).toHaveLength(3);
  });

  it("filters by category and combines it with the search", () => {
    expect(filterRows(rows, { query: "", category: "Bakery" }).map((r) => r.donationId)).toEqual([
      "a",
      "c",
    ]);
    expect(
      filterRows(rows, { query: "bread", category: "Fresh produce" }).map((r) => r.donationId),
    ).toEqual([]);
  });

  it("returns every row when no filter is set", () => {
    expect(filterRows(rows, { query: "", category: "all" })).toHaveLength(3);
  });
});

describe("sortByDeadline", () => {
  const rows = [
    row({ donationId: "late", pickupEnd: "2026-11-04T18:00:00.000Z" }),
    row({ donationId: "early", pickupEnd: "2026-11-04T16:00:00.000Z" }),
    row({ donationId: "middle", pickupEnd: "2026-11-04T17:00:00.000Z" }),
  ];

  it("puts the soonest pickup end first when ascending", () => {
    expect(sortByDeadline(rows, true).map((r) => r.donationId)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("reverses the order when descending", () => {
    expect(sortByDeadline(rows, false).map((r) => r.donationId)).toEqual([
      "late",
      "middle",
      "early",
    ]);
  });

  it("keeps a missing or unreadable pickup end last in both directions", () => {
    const withNull = rows.concat([row({ donationId: "none", pickupEnd: null })]);
    expect(sortByDeadline(withNull, true).at(-1)?.donationId).toBe("none");
    expect(sortByDeadline(withNull, false).at(-1)?.donationId).toBe("none");
  });

  it("does not change the input array", () => {
    const order = rows.map((r) => r.donationId);
    sortByDeadline(rows, false);
    expect(rows.map((r) => r.donationId)).toEqual(order);
  });
});

describe("paging", () => {
  const rows = Array.from({ length: 24 }, (_value, index) =>
    row({ donationId: String(index + 1) }),
  );

  it("counts the pages, never below 1", () => {
    expect(PAGE_SIZE).toBe(10);
    expect(pageCount(24)).toBe(3);
    expect(pageCount(20)).toBe(2);
    expect(pageCount(0)).toBe(1);
    expect(pageCount(24, 0)).toBe(1);
  });

  it("clamps a page to the pages that exist", () => {
    expect(safePage(9, 24)).toBe(3);
    expect(safePage(0, 24)).toBe(1);
    expect(safePage(2, 24)).toBe(2);
  });

  it("slices the requested page", () => {
    expect(pageSlice(rows, 1).map((r) => r.donationId)).toEqual(
      Array.from({ length: 10 }, (_value, index) => String(index + 1)),
    );
    expect(pageSlice(rows, 3).map((r) => r.donationId)).toEqual(["21", "22", "23", "24"]);
    expect(pageSlice(rows, 9).map((r) => r.donationId)).toEqual(["21", "22", "23", "24"]);
  });

  it("writes the summary in the static page's format", () => {
    expect(summaryText({ page: 1, total: 24 })).toBe("Showing 1–10 of 24");
    expect(summaryText({ page: 3, total: 24 })).toBe("Showing 21–24 of 24");
    expect(summaryText({ page: 9, total: 24 })).toBe("Showing 21–24 of 24");
    expect(summaryText({ page: 1, total: 0 })).toBe("Showing 0–0 of 0");
  });
});

describe("transitionFailure", () => {
  it("maps 409 to the notice sentence and asks for a reload", () => {
    const failure = transitionFailure(409);
    expect(failure.message).toBe(NOTICE);
    expect(failure.reload).toBe(true);
    expect(failure.refusal).toBe(true);
    expect(failure.tone).toBe("warning");
  });

  it("maps 404 to a reloading refusal", () => {
    const failure = transitionFailure(404);
    expect(failure.reload).toBe(true);
    expect(failure.refusal).toBe(true);
  });

  it("maps 403, 401 and 422 to refusals without a reload", () => {
    for (const status of [403, 401, 422]) {
      const failure = transitionFailure(status);
      expect(failure.refusal).toBe(true);
      expect(failure.reload).toBe(false);
      expect(failure.message).not.toBe("");
    }
  });

  it("maps 400 to a reloading refusal", () => {
    expect(transitionFailure(400).reload).toBe(true);
    expect(transitionFailure(400).refusal).toBe(true);
  });

  it("treats an unexpected status as a failure that keeps the dialog open", () => {
    for (const status of [500, 418]) {
      const failure = transitionFailure(status);
      expect(failure.refusal).toBe(false);
      expect(failure.reload).toBe(false);
      expect(failure.tone).toBe("error");
    }
  });
});

describe("validateReason", () => {
  it("refuses a blank or whitespace-only reason", () => {
    expect(validateReason("")).toEqual({ ok: false, message: "A reason is required." });
    expect(validateReason("   ")).toEqual({ ok: false, message: "A reason is required." });
  });

  it("returns the trimmed reason", () => {
    expect(validateReason("  Past the pickup window  ")).toEqual({
      ok: true,
      reason: "Past the pickup window",
    });
  });

  it("allows 500 characters and refuses 501", () => {
    expect(validateReason("x".repeat(500)).ok).toBe(true);
    expect(validateReason("x".repeat(501))).toEqual({
      ok: false,
      message: "Use at most 500 characters.",
    });
  });
});

describe("reportDetail", () => {
  function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      pickup: { pickup_end: "2026-11-04T18:00:00.000Z" },
      safety_checklist: { packaging_intact: true },
      allergens: ["Peanuts", "Soy"],
      ...overrides,
    };
  }

  it("reads expiry from pickup_end, and packaging and allergens from the report", () => {
    expect(reportDetail(report(), "UTC")).toEqual({
      expiry: "4 Nov 2026, 6:00 PM",
      packaging: "Packaging intact",
      allergens: "Peanuts, Soy",
    });
  });

  it("says packaging is not intact for false", () => {
    expect(reportDetail(report({ safety_checklist: { packaging_intact: false } }), "UTC").packaging)
      .toBe("Packaging not intact");
  });

  it("says packaging is not recorded for null, a missing key or no checklist", () => {
    expect(
      reportDetail(report({ safety_checklist: { packaging_intact: null } }), "UTC").packaging,
    ).toBe("Packaging not recorded");
    expect(reportDetail(report({ safety_checklist: {} }), "UTC").packaging).toBe(
      "Packaging not recorded",
    );
    expect(reportDetail(report({ safety_checklist: null }), "UTC").packaging).toBe(
      "Packaging not recorded",
    );
  });

  it("says None declared only for an empty allergens array", () => {
    expect(reportDetail(report({ allergens: [] }), "UTC").allergens).toBe("None declared");
    expect(reportDetail(report({ allergens: ["Milk"] }), "UTC").allergens).toBe("Milk");
  });

  it("does not call unreadable allergen entries an empty declaration", () => {
    expect(reportDetail(report({ allergens: [null] }), "UTC").allergens).toBe("Not recorded");
    expect(reportDetail(report({ allergens: [""] }), "UTC").allergens).toBe("Not recorded");
    expect(reportDetail(report({ allergens: ["Milk", 5] }), "UTC").allergens).toBe("Not recorded");
  });

  it("says allergens are not recorded when the key is missing", () => {
    const missing = report();
    delete missing.allergens;
    expect(reportDetail(missing, "UTC").allergens).toBe("Not recorded");
  });

  it("shows a dash when the pickup end is null", () => {
    expect(reportDetail(report({ pickup: { pickup_end: null } }), "UTC").expiry).toBe("—");
    expect(reportDetail(report({ pickup: null }), "UTC").expiry).toBe("—");
  });

  it("survives a body that is not an object", () => {
    expect(reportDetail(null, "UTC")).toEqual({
      expiry: "—",
      packaging: "Packaging not recorded",
      allergens: "Not recorded",
    });
  });
});

describe("parseQueueResponse", () => {
  it("accepts the queue answer", () => {
    const parsed = parseQueueResponse({ donations: [row()] });
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.donationId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("accepts an empty queue", () => {
    expect(parseQueueResponse({ donations: [] })).toEqual([]);
  });

  it("refuses anything that is not the queue shape", () => {
    for (const value of [null, undefined, "x", 5, [], {}, { donations: "x" }]) {
      expect(parseQueueResponse(value)).toBeNull();
    }
    expect(parseQueueResponse({ donations: [{ ...row(), portions: "24" }] })).toBeNull();
  });
});
