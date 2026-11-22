import { describe, expect, it } from "vitest";
import { StorageCondition } from "@/contracts/enums";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";
import type { TaskDetail } from "./inspection/pickup-inspection-logic";
import {
  buildSafetyLines,
  buildTaskView,
  checklistPath,
  taskDetailPath,
  taskLoadFailure,
} from "./task-detail-logic";

// Every date is built with the local constructor so the test never depends on a fixed zone.
const NOW = new Date(2026, 10, 21, 12, 0);

function task(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    donationId: "00000000-0000-4000-8000-000000000045",
    shortCode: "FL-0268",
    foodName: "Vegetable rice bowls",
    category: "Cooked meal",
    portions: 40,
    status: "ASSIGNED",
    pickupAddress: "18 Mabini Street, Brgy. Central, Quezon City",
    pickupStart: new Date(2026, 10, 21, 14, 0).toISOString(),
    pickupEnd: new Date(2026, 10, 21, 16, 0).toISOString(),
    donorName: "Green Table Kitchen",
    donorPhone: "+63 917 555 0128",
    ...overrides,
  };
}

function checklist(overrides: Partial<VolunteerChecklistResponse> = {}): VolunteerChecklistResponse {
  return {
    preparedAt: null,
    consumeByAt: null,
    storageCondition: null,
    storageTemperatureC: null,
    packagingIntact: null,
    allergensConfirmed: null,
    notCustomerPlateLeftovers: null,
    allergens: [],
    ...overrides,
  };
}

describe("buildTaskView", () => {
  it("formats the ASSIGNED header, summary and window", () => {
    expect(buildTaskView(task())).toEqual({
      title: "Vegetable rice bowls",
      subtitle: "#FL-0268 · Assigned",
      summary: "40 portions · Cooked meal",
      donorName: "Green Table Kitchen",
      donorPhone: "+63 917 555 0128",
      address: "18 Mabini Street, Brgy. Central, Quezon City",
      window: "21 Nov 2026 · 2:00–4:00 PM",
      canScan: true,
    });
  });

  it("writes one portion in the singular", () => {
    expect(buildTaskView(task({ portions: 1 })).summary).toBe("1 portion · Cooked meal");
  });

  it("labels every status and scans only while ASSIGNED", () => {
    expect(buildTaskView(task({ status: "PICKED_UP" })).subtitle).toBe("#FL-0268 · Picked up");
    expect(buildTaskView(task({ status: "PICKED_UP" })).canScan).toBe(false);
    expect(buildTaskView(task({ status: "DELIVERED" })).subtitle).toBe("#FL-0268 · Delivered");
    expect(buildTaskView(task({ status: "DELIVERED" })).canScan).toBe(false);
    expect(buildTaskView(task({ status: "ASSIGNED" })).canScan).toBe(true);
  });

  it("reads a missing address or window as Not set", () => {
    expect(buildTaskView(task({ pickupAddress: null })).address).toBe("Not set");
    expect(buildTaskView(task({ pickupStart: null })).window).toBe("Not set");
    expect(buildTaskView(task({ pickupEnd: null })).window).toBe("Not set");
    expect(buildTaskView(task({ pickupStart: "not-a-date" })).window).toBe("Not set");
  });

  it("keeps a hidden donor phone as null", () => {
    expect(buildTaskView(task({ donorPhone: null })).donorPhone).toBeNull();
  });
});

describe("buildSafetyLines", () => {
  it("returns exactly three lines for a full same-day checklist", () => {
    const lines = buildSafetyLines(
      checklist({
        preparedAt: new Date(2026, 10, 21, 9, 0).toISOString(),
        consumeByAt: new Date(2026, 10, 21, 18, 0).toISOString(),
        storageCondition: StorageCondition.HOT_HELD,
        storageTemperatureC: 63,
        packagingIntact: true,
        allergensConfirmed: true,
        notCustomerPlateLeftovers: true,
        allergens: ["Soy"],
      }),
      NOW,
    );
    expect(lines).toEqual([
      "Prepared 9:00 AM · Consume by 6:00 PM",
      "Hot-held · 63°C · Soy declared",
      "Packaging clean · Not opened or leftover",
    ]);
  });

  it("dates a consume-by on another calendar day", () => {
    const lines = buildSafetyLines(
      checklist({
        preparedAt: new Date(2026, 10, 20, 9, 0).toISOString(),
        consumeByAt: new Date(2026, 10, 22, 18, 0).toISOString(),
      }),
      NOW,
    );
    expect(lines[0]).toBe("Prepared Nov 20, 9:00 AM · Consume by Nov 22, 6:00 PM");
  });

  it("reads missing or unreadable dates as not recorded", () => {
    expect(buildSafetyLines(checklist(), NOW)[0]).toBe(
      "Prepared not recorded · Consume by not recorded",
    );
    expect(
      buildSafetyLines(checklist({ preparedAt: "not-a-date" }), NOW)[0],
    ).toBe("Prepared not recorded · Consume by not recorded");
  });

  it("judges the same instant by the caller's time zone", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const input = checklist({
      preparedAt: "2026-11-21T10:00:00.000Z",
      consumeByAt: "2026-11-22T01:30:00.000Z",
    });

    // Prepared is on now's day in all three zones, only the clock differs.
    expect(buildSafetyLines(input, now, "UTC")[0]).toBe(
      "Prepared 10:00 AM · Consume by Nov 22, 1:30 AM",
    );
    expect(buildSafetyLines(input, now, "Asia/Manila")[0]).toBe(
      "Prepared 6:00 PM · Consume by Nov 22, 9:30 AM",
    );
    // 01:30Z is still Nov 21 in Anchorage, so it stays a same-day time there.
    expect(buildSafetyLines(input, now, "America/Anchorage")[0]).toBe(
      "Prepared 1:00 AM · Consume by 4:30 PM",
    );
  });

  it("names every storage condition", () => {
    expect(buildSafetyLines(checklist({ storageCondition: StorageCondition.ROOM_TEMPERATURE }), NOW)[1]).toBe(
      "Room temperature · No allergens declared",
    );
    expect(buildSafetyLines(checklist({ storageCondition: StorageCondition.HOT_HELD }), NOW)[1]).toBe(
      "Hot-held · No allergens declared",
    );
    expect(buildSafetyLines(checklist({ storageCondition: StorageCondition.REFRIGERATED }), NOW)[1]).toBe(
      "Refrigerated · No allergens declared",
    );
    expect(buildSafetyLines(checklist({ storageCondition: StorageCondition.FROZEN }), NOW)[1]).toBe(
      "Frozen · No allergens declared",
    );
  });

  it("records missing storage and shows the temperature only when saved", () => {
    expect(buildSafetyLines(checklist(), NOW)[1]).toBe("Storage not recorded · No allergens declared");
    expect(
      buildSafetyLines(checklist({ storageTemperatureC: 4.5 }), NOW)[1],
    ).toBe("Storage not recorded · 4.5°C · No allergens declared");
    expect(
      buildSafetyLines(checklist({ storageCondition: StorageCondition.REFRIGERATED }), NOW)[1],
    ).toBe("Refrigerated · No allergens declared");
    expect(
      buildSafetyLines(
        checklist({ storageCondition: StorageCondition.REFRIGERATED, storageTemperatureC: 4 }),
        NOW,
      )[1],
    ).toBe("Refrigerated · 4°C · No allergens declared");
  });

  it("joins several allergens and never shows the confirmation answer", () => {
    expect(buildSafetyLines(checklist({ allergens: ["Soy", "Milk"] }), NOW)[1]).toBe(
      "Storage not recorded · Soy, Milk declared",
    );
    // An empty list reads the same whether it was confirmed or not.
    expect(buildSafetyLines(checklist({ allergensConfirmed: true }), NOW)[1]).toBe(
      "Storage not recorded · No allergens declared",
    );
    expect(buildSafetyLines(checklist({ allergensConfirmed: false }), NOW)[1]).toBe(
      "Storage not recorded · No allergens declared",
    );
    expect(buildSafetyLines(checklist({ allergensConfirmed: null }), NOW)[1]).toBe(
      "Storage not recorded · No allergens declared",
    );
  });

  it("writes every packaging and leftovers branch", () => {
    expect(buildSafetyLines(checklist({ packagingIntact: true, notCustomerPlateLeftovers: true }), NOW)[2]).toBe(
      "Packaging clean · Not opened or leftover",
    );
    expect(buildSafetyLines(checklist({ packagingIntact: false, notCustomerPlateLeftovers: false }), NOW)[2]).toBe(
      "Packaging not intact · Opened or leftover",
    );
    expect(buildSafetyLines(checklist({ packagingIntact: true, notCustomerPlateLeftovers: null }), NOW)[2]).toBe(
      "Packaging clean · Not recorded",
    );
    expect(buildSafetyLines(checklist({ packagingIntact: null, notCustomerPlateLeftovers: false }), NOW)[2]).toBe(
      "Packaging not recorded · Opened or leftover",
    );
    expect(buildSafetyLines(checklist(), NOW)[2]).toBe("Packaging not recorded · Not recorded");
  });
});

describe("screen paths and failures", () => {
  it("builds both answer routes and encodes the id", () => {
    expect(taskDetailPath("9fc03951-1111-4111-8111-111111111111")).toBe(
      "/api/volunteer/donations/9fc03951-1111-4111-8111-111111111111",
    );
    expect(taskDetailPath("../secrets")).toBe("/api/volunteer/donations/..%2Fsecrets");
    expect(checklistPath("9fc03951-1111-4111-8111-111111111111")).toBe(
      "/api/volunteer/donations/9fc03951-1111-4111-8111-111111111111/checklist",
    );
  });

  it("maps a response status to the screen failure", () => {
    expect(taskLoadFailure(404)).toBe("notFound");
    expect(taskLoadFailure(401)).toBe("session");
    expect(taskLoadFailure(403)).toBe("session");
    expect(taskLoadFailure(500)).toBe("error");
    expect(taskLoadFailure(0)).toBe("error");
  });
});
