import { describe, expect, it } from "vitest";
import {
  bannerText,
  contactLine,
  emptyState,
  filterItems,
  isToday,
  loadFailure,
  msUntilNextDay,
  mapRow,
  matchesSearch,
  parseTasksResponse,
  searchHaystack,
  taskCode,
  type TaskItem,
} from "./assigned-tasks-logic";

const PHONE = "+63 900 000 0000";
const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";
const UTC = "UTC";

function item(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    donationId: DONATION_ID,
    shortCode: "9FC03951",
    foodName: "Rice bowls",
    category: "Prepared food",
    portions: 12,
    status: "ASSIGNED",
    pickupAddress: "18 Mabini Street, Barangay Central",
    pickupStart: "2026-11-21T08:00:00.000Z",
    pickupEnd: "2026-11-21T10:00:00.000Z",
    donorName: "Test Donor",
    donorPhone: PHONE,
    ...overrides,
  };
}

function body(items: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return { items, page: 1, pageSize: 50, total: items.length, ...overrides };
}

describe("parseTasksResponse", () => {
  it("reads a valid body", () => {
    const parsed = parseTasksResponse(body([item()]));
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.donationId).toBe(DONATION_ID);
    expect(parsed?.[0]?.status).toBe("ASSIGNED");
  });

  it("keeps null dates", () => {
    const parsed = parseTasksResponse(
      body([item({ pickupStart: null, pickupEnd: null, pickupAddress: null })]),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.[0]?.pickupStart).toBeNull();
    expect(parsed?.[0]?.pickupEnd).toBeNull();
    expect(parsed?.[0]?.pickupAddress).toBeNull();
  });

  it("returns null when the envelope is the wrong shape", () => {
    expect(parseTasksResponse(null)).toBeNull();
    expect(parseTasksResponse({ page: 1 })).toBeNull();
    expect(parseTasksResponse({ items: "nope", page: 1, pageSize: 50, total: 0 })).toBeNull();
    expect(parseTasksResponse(body([], { total: "many" }))).toBeNull();
  });

  it("returns null when a row has the wrong shape", () => {
    const missingField = { ...item() } as Record<string, unknown>;
    delete missingField.foodName;
    expect(parseTasksResponse(body([missingField]))).toBeNull();
    expect(parseTasksResponse(body([{ ...item(), pickupStart: 7 }]))).toBeNull();
  });

  it("returns null for a status outside the three the list returns", () => {
    expect(parseTasksResponse(body([{ ...item(), status: "CLOSED" }]))).toBeNull();
    expect(parseTasksResponse(body([{ ...item(), status: "ASSIGNED " }]))).toBeNull();
  });
});

describe("taskCode", () => {
  it("prefixes the short code with a hash", () => {
    expect(taskCode("9FC03951")).toBe("#9FC03951");
  });

  it("does not double a leading hash", () => {
    expect(taskCode("#9FC03951")).toBe("#9FC03951");
  });
});

describe("mapRow", () => {
  it("formats the donation cell, status and action", () => {
    const row = mapRow(item(), UTC);
    expect(row.code).toBe("#9FC03951");
    expect(row.food).toBe("Rice bowls");
    expect(row.status).toBe("Assigned");
    expect(row.action).toBe("View task");
  });

  it("writes the p12 pickup window format", () => {
    const row = mapRow(
      item({
        pickupStart: "2026-11-21T08:00:00.000Z",
        pickupEnd: "2026-11-21T10:00:00.000Z",
      }),
      UTC,
    );
    expect(row.window).toBe("21 Nov 2026 · 8:00–10:00 AM");
  });

  it("writes Not set when a pickup time is missing", () => {
    expect(mapRow(item({ pickupEnd: null }), UTC).window).toBe("Not set");
    expect(mapRow(item({ pickupStart: null }), UTC).window).toBe("Not set");
    expect(mapRow(item({ pickupAddress: null }), UTC).location).toBe("Not set");
  });

  it("labels every status and the delivered action", () => {
    expect(mapRow(item({ status: "PICKED_UP" })).status).toBe("Picked up");
    expect(mapRow(item({ status: "PICKED_UP" })).action).toBe("View task");
    expect(mapRow(item({ status: "DELIVERED" })).status).toBe("Delivered");
    expect(mapRow(item({ status: "DELIVERED" })).action).toBe("Record distribution");
  });
});

describe("bannerText", () => {
  it("counts active, awaiting and unfinished reports", () => {
    const banner = bannerText([
      item({ status: "ASSIGNED" }),
      item({ status: "PICKED_UP" }),
      item({ status: "DELIVERED" }),
    ]);
    expect(banner.headline).toBe("2 active tasks");
    expect(banner.awaiting).toBe("1 awaiting pickup");
    expect(banner.reports).toBe("1 distribution report unfinished");
  });

  it("uses the singular active task", () => {
    const banner = bannerText([item({ status: "ASSIGNED" })]);
    expect(banner.headline).toBe("1 active task");
    expect(banner.reports).toBe("0 distribution reports unfinished");
  });

  it("pluralises the report count", () => {
    const banner = bannerText([
      item({ status: "DELIVERED" }),
      item({ status: "DELIVERED" }),
    ]);
    expect(banner.headline).toBe("0 active tasks");
    expect(banner.awaiting).toBe("0 awaiting pickup");
    expect(banner.reports).toBe("2 distribution reports unfinished");
  });
});

describe("matchesSearch", () => {
  it("matches the food name case-insensitively", () => {
    expect(matchesSearch(item(), "rice")).toBe(true);
    expect(matchesSearch(item(), "RICE")).toBe(true);
    expect(matchesSearch(item(), "stew")).toBe(false);
  });

  it("matches the code with and without the hash", () => {
    expect(matchesSearch(item(), "9FC03951")).toBe(true);
    expect(matchesSearch(item(), "#9fc03951")).toBe(true);
    expect(matchesSearch(item(), "9fc0")).toBe(true);
    expect(matchesSearch(item(), "0000")).toBe(false);
  });

  it("treats an empty search as no filter", () => {
    expect(matchesSearch(item(), "")).toBe(true);
    expect(matchesSearch(item(), "   ")).toBe(true);
  });
});

describe("isToday", () => {
  const now = new Date(2026, 10, 21, 12, 0, 0); // 21 Nov 2026, local time

  it("matches a pickupStart on the same local day", () => {
    const start = new Date(2026, 10, 21, 8, 0, 0).toISOString();
    expect(isToday(start, now)).toBe(true);
  });

  it("does not match another day", () => {
    const start = new Date(2026, 10, 20, 8, 0, 0).toISOString();
    expect(isToday(start, now)).toBe(false);
  });

  it("never matches a null start", () => {
    expect(isToday(null, now)).toBe(false);
  });
});

describe("filterItems", () => {
  const assigned = item({
    donationId: "11111111-1111-4111-8111-111111111111",
    shortCode: "11111111",
    foodName: "Rice bowls",
    status: "ASSIGNED",
    pickupStart: new Date(2026, 10, 21, 8).toISOString(),
  });
  const pickedUp = item({
    donationId: "22222222-2222-4222-8222-222222222222",
    shortCode: "22222222",
    foodName: "Vegetables",
    status: "PICKED_UP",
    pickupStart: new Date(2026, 10, 20, 8).toISOString(),
  });
  const delivered = item({
    donationId: "33333333-3333-4333-8333-333333333333",
    shortCode: "33333333",
    foodName: "Bread loaves",
    status: "DELIVERED",
    pickupStart: null,
  });
  const rows = [assigned, pickedUp, delivered];
  const now = new Date(2026, 10, 21, 12, 0, 0); // 21 Nov 2026, local time

  const run = (overrides: Partial<Parameters<typeof filterItems>[1]> = {}) =>
    filterItems(rows, { search: "", status: "all", date: "all", now, ...overrides });

  it("keeps everything with no filters", () => {
    expect(run()).toHaveLength(3);
  });

  it("filters by status", () => {
    expect(run({ status: "assigned" }).map((row) => row.shortCode)).toEqual(["11111111"]);
    expect(run({ status: "picked-up" }).map((row) => row.shortCode)).toEqual(["22222222"]);
    expect(run({ status: "delivered" }).map((row) => row.shortCode)).toEqual(["33333333"]);
  });

  it("filters by search on name and code", () => {
    expect(run({ search: "vegetables" }).map((row) => row.shortCode)).toEqual(["22222222"]);
    expect(run({ search: "#11111111" }).map((row) => row.shortCode)).toEqual(["11111111"]);
    expect(run({ search: "2222" })).toHaveLength(1);
  });

  it("filters Today on the local day and drops null starts", () => {
    expect(run({ date: "today" }).map((row) => row.shortCode)).toEqual(["11111111"]);
    expect(run({ date: "all" })).toHaveLength(3);
  });

  it("combines the three filters", () => {
    expect(run({ search: "rice", status: "delivered", date: "today" })).toHaveLength(0);
    expect(run({ search: "rice", status: "assigned", date: "today" })).toHaveLength(1);
  });
});

describe("contactLine", () => {
  it("picks the ASSIGNED row with the earliest pickupEnd", () => {
    const later = item({
      donationId: "11111111-1111-4111-8111-111111111111",
      donorName: "Test Donor",
      pickupEnd: "2026-11-21T16:00:00.000Z",
    });
    const sooner = item({
      donationId: "22222222-2222-4222-8222-222222222222",
      donorName: "Other Donor",
      pickupEnd: "2026-11-21T10:00:00.000Z",
    });
    expect(contactLine([later, sooner])).toBe(
      `Pickup task: Other Donor · ${PHONE} · 18 Mabini Street, Barangay Central`,
    );
  });

  it("sorts a null pickupEnd last", () => {
    const noEnd = item({
      donationId: "11111111-1111-4111-8111-111111111111",
      donorName: "No End Donor",
      pickupEnd: null,
    });
    const withEnd = item({
      donationId: "22222222-2222-4222-8222-222222222222",
      donorName: "With End Donor",
      pickupEnd: "2026-11-21T16:00:00.000Z",
    });
    expect(contactLine([noEnd, withEnd])).toContain("With End Donor");
    expect(contactLine([withEnd, noEnd])).toContain("With End Donor");
  });

  it("keeps list order on a pickupEnd tie", () => {
    const first = item({
      donationId: "11111111-1111-4111-8111-111111111111",
      donorName: "First Donor",
      pickupEnd: "2026-11-21T10:00:00.000Z",
    });
    const second = item({
      donationId: "22222222-2222-4222-8222-222222222222",
      donorName: "Second Donor",
      pickupEnd: "2026-11-21T10:00:00.000Z",
    });
    expect(contactLine([first, second])).toContain("First Donor");
  });

  it("returns null when no row is ASSIGNED", () => {
    expect(contactLine([item({ status: "PICKED_UP" }), item({ status: "DELIVERED" })])).toBeNull();
    expect(contactLine([])).toBeNull();
  });

  it("omits a null address from the line", () => {
    const line = contactLine([item({ pickupAddress: null })]);
    expect(line).toBe(`Pickup task: Test Donor · ${PHONE}`);
  });

  it("writes the line with name, phone and address", () => {
    expect(contactLine([item()])).toBe(
      `Pickup task: Test Donor · ${PHONE} · 18 Mabini Street, Barangay Central`,
    );
  });
});

describe("phone isolation", () => {
  const rows = [
    item({ status: "ASSIGNED" }),
    item({ status: "PICKED_UP", donationId: "22222222-2222-4222-8222-222222222222" }),
    item({ status: "DELIVERED", donationId: "33333333-3333-4333-8333-333333333333" }),
  ];

  it("keeps the phone out of the row views", () => {
    for (const row of rows) {
      expect(JSON.stringify(mapRow(row))).not.toContain(PHONE);
    }
  });

  it("keeps the phone out of the banner", () => {
    expect(JSON.stringify(bannerText(rows))).not.toContain(PHONE);
  });

  it("keeps the phone out of the search haystack", () => {
    for (const row of rows) {
      expect(searchHaystack(row)).not.toContain(PHONE);
      expect(matchesSearch(row, PHONE)).toBe(false);
    }
  });

  it("keeps the phone only in the contact line", () => {
    expect(contactLine(rows)).toContain(PHONE);
  });
});

describe("emptyState", () => {
  it("says the list itself is empty", () => {
    expect(emptyState(false)).toEqual({ title: "No assigned tasks yet" });
  });

  it("says the filters hid every row", () => {
    expect(emptyState(true)).toEqual({
      title: "No matching tasks",
      description: "Try a different search or filter.",
    });
  });
});

describe("loadFailure", () => {
  it("calls 401 and 403 a session problem", () => {
    expect(loadFailure(401)).toBe("session");
    expect(loadFailure(403)).toBe("session");
  });

  it("calls every other failure a plain error", () => {
    expect(loadFailure(500)).toBe("error");
    expect(loadFailure(404)).toBe("error");
  });
});

describe("unreadable dates", () => {
  it("shows Not set instead of failing when a pickup time cannot be read", () => {
    const row = mapRow(item({ pickupStart: "not-a-date" }), UTC);
    expect(row.window).toBe("Not set");
  });

  it("never matches Today", () => {
    expect(isToday("not-a-date", new Date(2026, 10, 21, 12, 0, 0))).toBe(false);
  });
});

describe("msUntilNextDay", () => {
  it("lands just after the next local midnight", () => {
    const now = new Date(2026, 10, 21, 12, 0, 0);
    const after = new Date(now.getTime() + msUntilNextDay(now));
    expect([after.getMonth(), after.getDate(), after.getHours(), after.getMinutes()]).toEqual([10, 22, 0, 0]);
    expect(msUntilNextDay(now)).toBeGreaterThan(0);
  });

  it("rolls over the end of a month", () => {
    const now = new Date(2026, 10, 30, 23, 59, 30);
    const after = new Date(now.getTime() + msUntilNextDay(now));
    expect([after.getMonth(), after.getDate()]).toEqual([11, 1]);
  });
});
