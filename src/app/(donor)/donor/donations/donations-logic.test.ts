import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  DONOR_DONATION_TAB_STATUSES,
  donorDonationListQuerySchema,
  donorDonationTabs,
} from "@/contracts/donor-donation-list";
import { formatDateTime, formatWindow } from "@/app/(donor)/donor/donate/review-logic";
import {
  buildListQuery,
  buildHighlights,
  buildTabs,
  emptyState,
  mapRow,
  pageCount,
  parseListResponse,
  parseTab,
  statusBelongsToTab,
  statusLabel,
  statusOptions,
  summaryText,
  type DonationListItemJson,
} from "./donations-logic";

function item(overrides: Partial<DonationListItemJson> = {}): DonationListItemJson {
  return {
    donationId: "9fc03951-0000-4000-8000-000000000001",
    shortCode: "9FC03951",
    foodName: "Test bread",
    category: "Bakery",
    portions: 24,
    status: DonationStatus.ASSIGNED,
    pickupStart: "2026-11-04T15:00:00.000Z",
    pickupEnd: "2026-11-04T17:00:00.000Z",
    updatedAt: "2026-11-03T08:00:00.000Z",
    checklistComplete: true,
    ...overrides,
  };
}

describe("statusLabel", () => {
  it("has a readable label for every status", () => {
    for (const status of Object.values(DonationStatus)) {
      const label = statusLabel(status);
      expect(label).not.toBe("");
      expect(label).not.toBe(status);
    }
  });

  it("writes REJECTED_AT_PICKUP in sentence case", () => {
    expect(statusLabel(DonationStatus.REJECTED_AT_PICKUP)).toBe("Rejected at pickup");
  });

  it("returns an unknown status unchanged", () => {
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("buildTabs and parseTab", () => {
  it("lists the four tabs without counts before the first answer", () => {
    const tabs = buildTabs(null);
    expect(tabs.map((tab) => tab.id)).toEqual(["drafts", "active", "completed", "not_completed"]);
    expect(tabs.every((tab) => tab.count === undefined)).toBe(true);
  });

  it("maps notCompleted to the not_completed tab", () => {
    const tabs = buildTabs({ drafts: 1, active: 3, completed: 24, notCompleted: 2 });
    expect(tabs.map((tab) => tab.count)).toEqual([1, 3, 24, 2]);
  });

  it("accepts the four tab ids and refuses anything else", () => {
    for (const tab of donorDonationTabs) expect(parseTab(tab)).toBe(tab);
    expect(parseTab("all")).toBeNull();
    expect(parseTab("")).toBeNull();
  });
});

describe("statusOptions and statusBelongsToTab", () => {
  it("starts with All, then the statuses of the tab", () => {
    expect(statusOptions("drafts")).toEqual([
      { value: "", label: "All" },
      { value: DonationStatus.DRAFT, label: "Draft" },
      { value: DonationStatus.SCREENED, label: "Screened" },
    ]);
  });

  it("lists exactly the contract statuses for every tab", () => {
    for (const tab of donorDonationTabs) {
      const values = statusOptions(tab)
        .slice(1)
        .map((option) => option.value);
      expect(values).toEqual([...DONOR_DONATION_TAB_STATUSES[tab]]);
    }
  });

  it("accepts a status of the tab or none, and refuses one of another tab", () => {
    expect(statusBelongsToTab("active", DonationStatus.POSTED)).toBe(true);
    expect(statusBelongsToTab("active", "")).toBe(true);
    expect(statusBelongsToTab("active", DonationStatus.CLOSED)).toBe(false);
  });
});

describe("pageCount", () => {
  it("rounds up", () => {
    expect(pageCount(24, 20)).toBe(2);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });

  it("is never below 1, even for an empty list or a bad page size", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(10, 0)).toBe(1);
  });
});

describe("buildListQuery", () => {
  const base = { tab: "active", search: "", status: "", page: 1, pageSize: 20 } as const;

  it("sends only tab, page and page size by default", () => {
    expect(buildListQuery(base)).toBe("tab=active&page=1&pageSize=20");
  });

  it("trims the search and leaves a blank one out", () => {
    expect(new URLSearchParams(buildListQuery({ ...base, search: "  bread  " })).get("q")).toBe(
      "bread",
    );
    expect(new URLSearchParams(buildListQuery({ ...base, search: "   " })).has("q")).toBe(false);
  });

  it("cuts the search at 100 characters", () => {
    const q = new URLSearchParams(buildListQuery({ ...base, search: "x".repeat(150) })).get("q");
    expect(q).toHaveLength(100);
  });

  it("keeps a status of the tab and drops one of another tab", () => {
    const kept = buildListQuery({ ...base, status: DonationStatus.POSTED });
    expect(new URLSearchParams(kept).get("status")).toBe(DonationStatus.POSTED);
    const dropped = buildListQuery({ ...base, status: DonationStatus.CLOSED });
    expect(new URLSearchParams(dropped).has("status")).toBe(false);
  });

  it("encodes special characters so they stay one value", () => {
    const params = new URLSearchParams(buildListQuery({ ...base, search: "a&b=c" }));
    expect(params.get("q")).toBe("a&b=c");
    expect(params.has("b")).toBe(false);
  });

  it("produces a query the server schema accepts", () => {
    const queries = [
      buildListQuery(base),
      buildListQuery({ ...base, tab: "drafts", search: "#9FC0", status: DonationStatus.SCREENED }),
      buildListQuery({ ...base, tab: "not_completed", page: 3, pageSize: 50 }),
    ];
    for (const query of queries) {
      const parsed = donorDonationListQuerySchema.safeParse(
        Object.fromEntries(new URLSearchParams(query)),
      );
      expect(parsed.success).toBe(true);
    }
  });
});

describe("summaryText", () => {
  const base = { tab: "active", page: 1, pageSize: 20, total: 24, itemCount: 20 } as const;

  it("shows the range on the first page", () => {
    expect(summaryText(base)).toBe("Showing 1–20 of 24 active donations");
  });

  it("shows the range on the last page", () => {
    expect(summaryText({ ...base, page: 2, itemCount: 4 })).toBe(
      "Showing 21–24 of 24 active donations",
    );
  });

  it("uses the singular for a single donation", () => {
    expect(summaryText({ ...base, total: 1, itemCount: 1 })).toBe("Showing 1 of 1 active donation");
  });

  it("says 0 when there are no donations", () => {
    expect(summaryText({ ...base, total: 0, itemCount: 0 })).toBe("0 active donations");
  });

  it("keeps the true total for a page past the end", () => {
    expect(summaryText({ ...base, page: 9, itemCount: 0 })).toBe("Showing 0 of 24 active donations");
  });

  it("writes the not completed tab as two words", () => {
    expect(summaryText({ ...base, tab: "not_completed", total: 2, itemCount: 2 })).toBe(
      "Showing 1–2 of 2 not completed donations",
    );
  });
});

describe("emptyState", () => {
  it("has its own text for every tab", () => {
    const titles = donorDonationTabs.map((tab) => emptyState(tab, false).title);
    expect(new Set(titles).size).toBe(4);
    for (const tab of donorDonationTabs) {
      expect(emptyState(tab, false).description).not.toBe("");
    }
  });

  it("says no match when a search or status filter is on", () => {
    for (const tab of donorDonationTabs) {
      expect(emptyState(tab, true).title).toBe("No matching donations");
    }
  });
});

describe("mapRow", () => {
  it("maps the fields and writes the status as a label", () => {
    const row = mapRow(item(), "UTC");
    expect(row.id).toBe("9fc03951-0000-4000-8000-000000000001");
    expect(row.code).toBe("#9FC03951");
    expect(row.name).toBe("Test bread");
    expect(row.category).toBe("Bakery");
    expect(row.portions).toBe(24);
    expect(row.status).toBe("Assigned");
  });

  it("does not double the # when the short code already has one", () => {
    expect(mapRow(item({ shortCode: "#9FC03951" }), "UTC").code).toBe("#9FC03951");
  });

  it("writes the pickup window with the given time zone", () => {
    const row = mapRow(item(), "UTC");
    expect(row.pickup).toBe(
      formatWindow("2026-11-04T15:00:00.000Z", "2026-11-04T17:00:00.000Z", "UTC"),
    );
    expect(row.pickup).not.toBe("—");
  });

  it("shows a dash when a pickup end is missing", () => {
    expect(mapRow(item({ pickupStart: null }), "UTC").pickup).toBe("—");
    expect(mapRow(item({ pickupEnd: null }), "UTC").pickup).toBe("—");
  });

  it("shows a dash when a pickup date cannot be read", () => {
    expect(mapRow(item({ pickupStart: "not-a-date" }), "UTC").pickup).toBe("—");
  });

  it("links DRAFT and SCREENED rows to the wizard with the draft id", () => {
    for (const status of [DonationStatus.DRAFT, DonationStatus.SCREENED]) {
      const row = mapRow(item({ status }), "UTC");
      expect(row.action).toEqual({
        label: "Resume draft",
        href: "/donor/donate?draft=9fc03951-0000-4000-8000-000000000001",
      });
    }
  });

  it("gives every other status no link", () => {
    for (const status of Object.values(DonationStatus)) {
      if (status === DonationStatus.DRAFT || status === DonationStatus.SCREENED) continue;
      expect(mapRow(item({ status }), "UTC").action).toBeNull();
    }
  });

  it("encodes the draft id in the link", () => {
    const row = mapRow(item({ status: DonationStatus.DRAFT, donationId: "a b" }), "UTC");
    expect(row.action?.href).toBe("/donor/donate?draft=a%20b");
  });
});

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tab: "active",
    items: [item()],
    page: 1,
    pageSize: 20,
    total: 1,
    counts: { drafts: 0, active: 1, completed: 0, notCompleted: 0 },
    ...overrides,
  };
}

describe("parseListResponse", () => {
  it("accepts a full answer", () => {
    const parsed = parseListResponse(body());
    expect(parsed?.tab).toBe("active");
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.counts.notCompleted).toBe(0);
  });

  it("accepts an empty list", () => {
    expect(parseListResponse(body({ items: [], total: 0 }))?.items).toEqual([]);
  });

  it("refuses a body that is not an object", () => {
    for (const value of [null, undefined, "x", 5, []]) {
      expect(parseListResponse(value)).toBeNull();
    }
  });

  it("refuses an unknown tab", () => {
    expect(parseListResponse(body({ tab: "all" }))).toBeNull();
  });

  it("refuses an item with a wrong field type", () => {
    expect(parseListResponse(body({ items: [{ ...item(), portions: "24" }] }))).toBeNull();
  });

  it("refuses an answer without counts", () => {
    expect(parseListResponse(body({ counts: undefined }))).toBeNull();
  });

  it("refuses a page or total out of range", () => {
    expect(parseListResponse(body({ page: 0 }))).toBeNull();
    expect(parseListResponse(body({ total: -1 }))).toBeNull();
  });
});

describe("buildHighlights", () => {
  it("returns no cards when both rows are missing", () => {
    expect(buildHighlights(null, null, "UTC")).toEqual([]);
  });

  it("builds the drafts card with the checklist state and the saved time", () => {
    const draft = item({
      status: DonationStatus.DRAFT,
      foodName: "Test oatmeal",
      checklistComplete: false,
    });
    const [card] = buildHighlights(draft, null, "UTC");
    expect(card.label).toBe("Drafts");
    expect(card.tone).toBe("default");
    expect(card.title).toBe("Test oatmeal");
    expect(card.text).toBe(
      "Safety checklist incomplete · Saved " + formatDateTime(draft.updatedAt, "UTC"),
    );
  });

  it("says the checklist is complete when it is", () => {
    const [card] = buildHighlights(
      item({ status: DonationStatus.SCREENED, checklistComplete: true }),
      null,
      "UTC",
    );
    expect(card.text.startsWith("Safety checklist complete")).toBe(true);
  });

  it("leaves the saved time out when the date cannot be read", () => {
    const [card] = buildHighlights(
      item({ status: DonationStatus.DRAFT, checklistComplete: false, updatedAt: "bad" }),
      null,
      "UTC",
    );
    expect(card.text).toBe("Safety checklist incomplete");
  });

  it("offers only Resume draft on the drafts card, linked to the wizard", () => {
    const draft = item({ status: DonationStatus.DRAFT });
    const [card] = buildHighlights(draft, null, "UTC");
    expect(card.actions).toEqual([
      {
        label: "Resume draft",
        href: "/donor/donate?draft=" + draft.donationId,
        arrow: true,
      },
    ]);
  });

  it("builds the not completed card from the code, the status and the food name", () => {
    const [card] = buildHighlights(
      null,
      item({ status: DonationStatus.EXPIRED, foodName: "Test bread" }),
      "UTC",
    );
    expect(card.label).toBe("Not completed");
    expect(card.tone).toBe("error");
    expect(card.title).toBe("#9FC03951 · Expired");
    expect(card.text).toBe("Test bread");
    expect(card.actions).toEqual([]);
  });

  it("puts the drafts card first when both exist", () => {
    const cards = buildHighlights(
      item({ status: DonationStatus.DRAFT }),
      item({ status: DonationStatus.CANCELLED }),
      "UTC",
    );
    expect(cards.map((card) => card.label)).toEqual(["Drafts", "Not completed"]);
  });

  it("builds only the card whose row exists", () => {
    expect(buildHighlights(null, item({ status: DonationStatus.DECLINED }), "UTC")).toHaveLength(1);
    expect(buildHighlights(item({ status: DonationStatus.DRAFT }), null, "UTC")).toHaveLength(1);
  });
});
