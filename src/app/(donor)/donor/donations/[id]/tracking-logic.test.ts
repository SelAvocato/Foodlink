import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  buildJourney,
  foodSafetyLines,
  parseTrackingResponse,
  pickupCountdown,
  shortCode,
  statusTone,
  trackingActions,
  volunteerText,
  type TrackingReport,
} from "./tracking-logic";

// Every date check passes its own zone, so no test depends on the machine's.
const UTC = "UTC";
const MANILA = "Asia/Manila";

type TimelineEntry = {
  type: string | null;
  from: string | null;
  to: string | null;
  at: string | null;
};

function entry(
  to: string | null,
  at: string | null,
  type = "TRANSITION",
  from: string | null = null,
): TimelineEntry {
  return { type, from, to, at };
}

function checklist(
  overrides: Partial<NonNullable<TrackingReport["safety_checklist"]>> = {},
): NonNullable<TrackingReport["safety_checklist"]> {
  return {
    prepared_at: "2026-11-04T01:00:00.000Z",
    consume_by_at: "2026-11-04T10:00:00.000Z",
    storage_condition: "HOT_HELD",
    storage_temperature_c: 63,
    packaging_intact: true,
    completed_at: "2026-11-04T00:30:00.000Z",
    ...overrides,
  };
}

function makeReport(
  overrides: {
    status?: string;
    foodName?: string | null;
    category?: string | null;
    portions?: number | null;
    closedAt?: string | null;
    volunteer?: TrackingReport["volunteer"];
    pickup?: TrackingReport["pickup"];
    checklist?: TrackingReport["safety_checklist"];
    allergens?: string[] | null;
    exit?: TrackingReport["exit"];
    entries?: unknown[] | null;
    portionsDistributed?: number | null;
    portionsDonated?: number | null;
    timeline?: TimelineEntry[] | null;
  } = {},
): TrackingReport {
  // `??` would turn an explicit null (a real report value) into the default.
  return {
    donation: {
      status: overrides.status ?? DonationStatus.ASSIGNED,
      food_name: overrides.foodName === undefined ? "Test bread" : overrides.foodName,
      category: overrides.category === undefined ? "Bakery" : overrides.category,
      portions: overrides.portions === undefined ? 24 : overrides.portions,
      closed_at: overrides.closedAt === undefined ? null : overrides.closedAt,
    },
    volunteer: overrides.volunteer === undefined ? null : overrides.volunteer,
    pickup: overrides.pickup === undefined ? null : overrides.pickup,
    safety_checklist: overrides.checklist === undefined ? null : overrides.checklist,
    allergens: overrides.allergens === undefined ? null : overrides.allergens,
    exit: overrides.exit === undefined ? null : overrides.exit,
    distribution: { entries: overrides.entries === undefined ? [] : overrides.entries },
    impact: {
      portions_donated:
        overrides.portionsDonated === undefined
          ? overrides.portions === undefined || overrides.portions === null
            ? 24
            : overrides.portions
          : overrides.portionsDonated,
      portions_distributed: overrides.portionsDistributed ?? 0,
    },
    timeline: overrides.timeline === undefined ? [] : overrides.timeline,
  };
}

describe("parseTrackingResponse", () => {
  it("accepts the route's { report } body and keeps unknown keys loose", () => {
    const parsed = parseTrackingResponse({
      report: makeReport({ status: DonationStatus.POSTED }),
      ignored: true,
    });
    expect(parsed?.donation.status).toBe(DonationStatus.POSTED);
    expect(parsed?.donation.food_name).toBe("Test bread");
  });

  it("accepts a report whose nullable blocks are all null", () => {
    const parsed = parseTrackingResponse({
      report: makeReport({
        volunteer: null,
        pickup: null,
        checklist: null,
        allergens: null,
        exit: null,
        timeline: null,
        entries: null,
      }),
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.timeline).toBeNull();
  });

  it("accepts an unknown status instead of guessing", () => {
    expect(
      parseTrackingResponse({ report: makeReport({ status: "SOMETHING_NEW" }) })?.donation.status,
    ).toBe("SOMETHING_NEW");
  });

  it("returns null for a malformed body", () => {
    for (const body of [null, undefined, "x", 5, [], {}, { report: null }]) {
      expect(parseTrackingResponse(body)).toBeNull();
    }
  });

  it("returns null when a used key has the wrong shape", () => {
    const base = makeReport();
    expect(
      parseTrackingResponse({ report: { ...base, donation: { ...base.donation, status: 5 } } }),
    ).toBeNull();
    expect(
      parseTrackingResponse({
        report: { ...base, timeline: [{ ...entry("POSTED", "2026-11-04T01:00:00.000Z"), at: 5 }] },
      }),
    ).toBeNull();
    expect(
      parseTrackingResponse({ report: { ...base, distribution: { entries: "none" } } }),
    ).toBeNull();
    expect(parseTrackingResponse({ report: { ...base, impact: {} } })).toBeNull();
  });
});

describe("shortCode", () => {
  it("uses the first 8 characters, upper case, with a #", () => {
    expect(shortCode("9fc03951-0000-4000-8000-000000000001")).toBe("#9FC03951");
    expect(shortCode("abc")).toBe("#ABC");
  });
});

describe("buildJourney", () => {
  it("always lists the six steps in order, pending when nothing happened", () => {
    const steps = buildJourney(makeReport({ status: DonationStatus.DRAFT }), UTC);
    expect(steps.map((step) => step.title)).toEqual([
      "Posted",
      "Accepted",
      "Volunteer assigned",
      "Picked up",
      "Delivered",
      "Distributed",
    ]);
    expect(steps.map((step) => step.done)).toEqual([false, false, false, false, false, false]);
    expect(steps.map((step) => step.detail)).toEqual([
      "Pending",
      "Pending",
      "Pending",
      "Pending · Pickup photo and timestamp appear here",
      "Pending · Handover photo and timestamp appear here",
      "Pending · Live distribution entries appear here",
    ]);
  });

  it("builds every done step with its detail in the given time zone", () => {
    const steps = buildJourney(
      makeReport({
        status: DonationStatus.CLOSED,
        checklist: checklist(),
        volunteer: { first_name: "Ana", phone: null },
        entries: [{ place: "Hall" }],
        portionsDistributed: 24,
        timeline: [
          entry("POSTED", "2026-11-04T01:00:00.000Z"),
          entry("ACCEPTED", "2026-11-04T02:00:00.000Z"),
          entry("ASSIGNED", "2026-11-04T03:00:00.000Z"),
          entry("PICKED_UP", "2026-11-04T04:00:00.000Z"),
          entry("DELIVERED", "2026-11-04T05:00:00.000Z"),
        ],
      }),
      UTC,
    );
    expect(steps.map((step) => step.done)).toEqual([true, true, true, true, true, true]);
    expect(steps.map((step) => step.detail)).toEqual([
      "4 Nov 2026, 1:00 AM · Safety checklist confirmed",
      "4 Nov 2026, 2:00 AM · Organization accepted",
      "4 Nov 2026, 3:00 AM · Ana will collect your food",
      "4 Nov 2026, 4:00 AM",
      "4 Nov 2026, 5:00 AM",
      "1 entry · 24 of 24 portions distributed",
    ]);
  });

  it("reads the times in the requested time zone", () => {
    const steps = buildJourney(
      makeReport({ timeline: [entry("POSTED", "2026-11-04T01:00:00.000Z")] }),
      MANILA,
    );
    expect(steps[0].detail).toBe("4 Nov 2026, 9:00 AM");
  });

  it("uses the earliest matching transition, whatever the array order", () => {
    const steps = buildJourney(
      makeReport({
        timeline: [
          entry("POSTED", "2026-11-04T03:00:00.000Z"),
          entry("POSTED", "2026-11-04T01:00:00.000Z"),
        ],
      }),
      UTC,
    );
    expect(steps[0].detail).toBe("4 Nov 2026, 1:00 AM");
  });

  it("ignores REASSIGNED entries", () => {
    const onlyReassigned = buildJourney(
      makeReport({
        timeline: [entry("ASSIGNED", "2026-11-04T00:30:00.000Z", "REASSIGNED")],
      }),
      UTC,
    );
    expect(onlyReassigned[2]).toEqual({
      title: "Volunteer assigned",
      detail: "Pending",
      done: false,
    });

    const both = buildJourney(
      makeReport({
        timeline: [
          entry("ASSIGNED", "2026-11-04T00:30:00.000Z", "REASSIGNED"),
          entry("ASSIGNED", "2026-11-04T03:00:00.000Z"),
        ],
      }),
      UTC,
    );
    expect(both[2].detail).toBe("4 Nov 2026, 3:00 AM");
  });

  it("only claims the checklist when completed_at is set", () => {
    const withoutChecklist = buildJourney(
      makeReport({ timeline: [entry("POSTED", "2026-11-04T01:00:00.000Z")] }),
      UTC,
    );
    expect(withoutChecklist[0].detail).toBe("4 Nov 2026, 1:00 AM");

    const incomplete = buildJourney(
      makeReport({
        checklist: checklist({ completed_at: null }),
        timeline: [entry("POSTED", "2026-11-04T01:00:00.000Z")],
      }),
      UTC,
    );
    expect(incomplete[0].detail).toBe("4 Nov 2026, 1:00 AM");
  });

  it("writes just the time when no volunteer is on the report", () => {
    const steps = buildJourney(
      makeReport({
        volunteer: null,
        timeline: [entry("ASSIGNED", "2026-11-04T03:00:00.000Z")],
      }),
      UTC,
    );
    expect(steps[2].detail).toBe("4 Nov 2026, 3:00 AM");
  });

  it("summarises Distributed with entry and portion counts", () => {
    const many = buildJourney(
      makeReport({
        entries: [{}, {}],
        portionsDistributed: 20,
        portionsDonated: 24,
      }),
      UTC,
    );
    expect(many[5]).toEqual({
      title: "Distributed",
      detail: "2 entries · 20 of 24 portions distributed",
      done: true,
    });

    const single = buildJourney(
      makeReport({ entries: [{}], portionsDistributed: 1, portionsDonated: 1 }),
      UTC,
    );
    expect(single[5].detail).toBe("1 entry · 1 of 1 portion distributed");
  });

  it("appends one final step for every exit state", () => {
    const labels: [string, string][] = [
      [DonationStatus.REJECTED, "Rejected"],
      [DonationStatus.DECLINED, "Declined"],
      [DonationStatus.REJECTED_AT_PICKUP, "Rejected at pickup"],
      [DonationStatus.CANCELLED, "Cancelled"],
    ];
    for (const [status, label] of labels) {
      const steps = buildJourney(
        makeReport({
          status,
          timeline: [entry(DonationStatus.POSTED, "2026-11-04T00:40:00.000Z")],
          exit: {
            reason: "No longer safe to collect",
            occurred_at: "2026-11-04T06:00:00.000Z",
          },
        }),
        UTC,
      );
      expect(steps).toHaveLength(2);
      expect(steps.every((step) => step.done)).toBe(true);
      expect(steps[1]).toEqual({
        title: label,
        detail: "4 Nov 2026, 6:00 AM · No longer safe to collect",
        done: true,
      });
    }
  });

  it("after an exit keeps only the steps that happened", () => {
    const steps = buildJourney(
      makeReport({
        status: DonationStatus.CANCELLED,
        timeline: [
          entry(DonationStatus.POSTED, "2026-11-04T00:40:00.000Z"),
          entry(DonationStatus.ACCEPTED, "2026-11-04T01:10:00.000Z"),
        ],
        exit: { reason: null, occurred_at: "2026-11-04T06:00:00.000Z" },
      }),
      UTC,
    );
    expect(steps.map((step) => step.title)).toEqual(["Posted", "Accepted", "Cancelled"]);
    expect(steps.every((step) => step.done)).toBe(true);
  });

  it("leaves the reason out when the exit has none", () => {
    const steps = buildJourney(
      makeReport({
        status: DonationStatus.CANCELLED,
        exit: { reason: null, occurred_at: "2026-11-04T06:00:00.000Z" },
      }),
      UTC,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      title: "Cancelled",
      detail: "4 Nov 2026, 6:00 AM",
      done: true,
    });
  });

  it("describes an EXPIRED donation without an exit row", () => {
    const withClosedAt = buildJourney(
      makeReport({
        status: DonationStatus.EXPIRED,
        closedAt: "2026-11-04T07:30:00.000Z",
      }),
      UTC,
    );
    expect(withClosedAt).toHaveLength(1);
    expect(withClosedAt[0]).toEqual({
      title: "Expired",
      detail: "4 Nov 2026, 7:30 AM · Pickup window passed",
      done: true,
    });

    const withoutClosedAt = buildJourney(
      makeReport({ status: DonationStatus.EXPIRED, closedAt: null }),
      UTC,
    );
    expect(withoutClosedAt[0]).toEqual({
      title: "Expired",
      detail: "Pickup window passed",
      done: true,
    });
  });

  it("uses the exit row, not the EXPIRED fallback, and appends only one step", () => {
    const steps = buildJourney(
      makeReport({
        status: DonationStatus.EXPIRED,
        closedAt: "2026-11-04T07:30:00.000Z",
        exit: {
          reason: "Pickup window closed",
          occurred_at: "2026-11-04T08:00:00.000Z",
        },
      }),
      UTC,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      title: "Expired",
      detail: "4 Nov 2026, 8:00 AM · Pickup window closed",
      done: true,
    });
    expect(steps.filter((step) => step.title === "Expired")).toHaveLength(1);
  });

  it("shows an unknown status unchanged in the appended step", () => {
    const steps = buildJourney(
      makeReport({
        status: "SOMETHING_NEW",
        exit: { reason: "Admin note", occurred_at: "2026-11-04T06:00:00.000Z" },
      }),
      UTC,
    );
    expect(steps).toHaveLength(1);
    expect(steps[0].title).toBe("SOMETHING_NEW");
  });
});

describe("statusTone", () => {
  it("groups the statuses by meaning", () => {
    expect(statusTone(DonationStatus.DELIVERED)).toBe("success");
    expect(statusTone(DonationStatus.CLOSED)).toBe("success");

    for (const status of [
      DonationStatus.REJECTED,
      DonationStatus.DECLINED,
      DonationStatus.REJECTED_AT_PICKUP,
      DonationStatus.CANCELLED,
      DonationStatus.EXPIRED,
    ]) {
      expect(statusTone(status)).toBe("error");
    }

    for (const status of [
      DonationStatus.POSTED,
      DonationStatus.ACCEPTED,
      DonationStatus.ASSIGNED,
      DonationStatus.PICKED_UP,
    ]) {
      expect(statusTone(status)).toBe("warning");
    }
  });

  it("is neutral for draft, screened and unknown codes", () => {
    expect(statusTone(DonationStatus.DRAFT)).toBe("neutral");
    expect(statusTone(DonationStatus.SCREENED)).toBe("neutral");
    expect(statusTone("SOMETHING_NEW")).toBe("neutral");
  });
});

describe("trackingActions", () => {
  it("offers the QR while the donation is posted, accepted or assigned", () => {
    for (const status of [
      DonationStatus.POSTED,
      DonationStatus.ACCEPTED,
      DonationStatus.ASSIGNED,
    ]) {
      expect(trackingActions(status).showQr).toBe(true);
    }
    for (const status of [DonationStatus.PICKED_UP, DonationStatus.CLOSED, "SOMETHING_NEW"]) {
      expect(trackingActions(status).showQr).toBe(false);
    }
  });

  it("allows cancelling only before a volunteer is assigned", () => {
    expect(trackingActions(DonationStatus.POSTED).canCancel).toBe(true);
    expect(trackingActions(DonationStatus.ACCEPTED).canCancel).toBe(true);
    expect(trackingActions(DonationStatus.ASSIGNED).canCancel).toBe(false);
    expect(trackingActions(DonationStatus.PICKED_UP).canCancel).toBe(false);
  });

  it("explains why cancelling is unavailable from ASSIGNED to DELIVERED", () => {
    for (const status of [
      DonationStatus.ASSIGNED,
      DonationStatus.PICKED_UP,
      DonationStatus.DELIVERED,
    ]) {
      expect(trackingActions(status).cancelUnavailableNote).toBe(true);
    }
    for (const status of [
      DonationStatus.POSTED,
      DonationStatus.ACCEPTED,
      DonationStatus.CLOSED,
      "SOMETHING_NEW",
    ]) {
      expect(trackingActions(status).cancelUnavailableNote).toBe(false);
    }
  });

  it("returns all false for a status with no actions", () => {
    expect(trackingActions("SOMETHING_NEW")).toEqual({
      showQr: false,
      canCancel: false,
      cancelUnavailableNote: false,
    });
  });
});

describe("pickupCountdown", () => {
  const now = new Date("2026-11-04T12:00:00.000Z");

  it("counts minutes under an hour", () => {
    expect(pickupCountdown("2026-11-04T12:45:00.000Z", now)).toBe("Ends in 45m");
    expect(pickupCountdown("2026-11-04T12:00:30.000Z", now)).toBe("Ends in 1m");
  });

  it("counts hours and minutes on the same day", () => {
    expect(pickupCountdown("2026-11-04T14:15:00.000Z", now)).toBe("Ends in 2h 15m");
    expect(pickupCountdown("2026-11-04T15:00:00.000Z", now)).toBe("Ends in 3h");
  });

  it("counts days and hours past a day", () => {
    expect(pickupCountdown("2026-11-05T15:00:00.000Z", now)).toBe("Ends in 1d 3h");
  });

  it("is null when the window already ended or the end is missing", () => {
    expect(pickupCountdown(null, now)).toBeNull();
    expect(pickupCountdown("2026-11-04T12:00:00.000Z", now)).toBeNull();
    expect(pickupCountdown("2026-11-04T11:59:00.000Z", now)).toBeNull();
  });

  it("accepts an injected now as an ISO string", () => {
    expect(pickupCountdown("2026-11-04T14:15:00.000Z", "2026-11-04T12:00:00.000Z")).toBe(
      "Ends in 2h 15m",
    );
  });
});

describe("volunteerText", () => {
  it("says no volunteer is assigned yet", () => {
    expect(volunteerText(null)).toEqual(["No volunteer assigned yet."]);
  });

  it("hides the phone behind the pickup-window note", () => {
    expect(volunteerText({ first_name: "Ana", phone: null })).toEqual([
      "Ana",
      "Phone hidden until pickup day, within the pickup window.",
    ]);
  });

  it("shows the phone when it is there", () => {
    expect(volunteerText({ first_name: "Ana", phone: "0917 123 4567" })).toEqual([
      "Ana",
      "0917 123 4567",
    ]);
  });
});

describe("foodSafetyLines", () => {
  it("writes portions, category and the checklist answers", () => {
    const lines = foodSafetyLines(
      makeReport({
        checklist: checklist(),
        allergens: ["Milk", "Peanuts"],
      }),
      UTC,
    );
    expect(lines).toEqual([
      "24 portions · Bakery",
      "Prepared: 4 Nov 2026, 1:00 AM",
      "Consume by: 4 Nov 2026, 10:00 AM",
      "Storage: Hot-held · 63°C",
      "Allergens: Milk, Peanuts",
      "Packaging clean and sealed",
    ]);
  });

  it("formats the times in the requested zone", () => {
    const lines = foodSafetyLines(makeReport({ checklist: checklist() }), MANILA);
    expect(lines).toContain("Prepared: 4 Nov 2026, 9:00 AM");
    expect(lines).toContain("Consume by: 4 Nov 2026, 6:00 PM");
  });

  it("shows an unknown storage condition exactly as it came", () => {
    const lines = foodSafetyLines(
      makeReport({
        checklist: checklist({ storage_condition: "VACUUM_SEALED", storage_temperature_c: 20 }),
      }),
      UTC,
    );
    expect(lines).toContain("Storage: VACUUM_SEALED · 20°C");
  });

  it("leaves the temperature off when it is null", () => {
    const lines = foodSafetyLines(
      makeReport({ checklist: checklist({ storage_temperature_c: null }) }),
      UTC,
    );
    expect(lines).toContain("Storage: Hot-held");
  });

  it("says no allergens were declared", () => {
    expect(foodSafetyLines(makeReport({ allergens: [] }), UTC)).toContain(
      "Allergens: None declared",
    );
    expect(foodSafetyLines(makeReport({ allergens: null }), UTC)).toContain(
      "Allergens: None declared",
    );
  });

  it("uses the singular for one portion and omits what the report lacks", () => {
    const lines = foodSafetyLines(
      makeReport({ portions: 1, checklist: null, allergens: null }),
      UTC,
    );
    expect(lines).toEqual(["1 portion · Bakery", "Allergens: None declared"]);
  });

  it("omits the summary when portions and category are both null", () => {
    const lines = foodSafetyLines(
      makeReport({ portions: null, category: null, checklist: null }),
      UTC,
    );
    expect(lines).toEqual(["Allergens: None declared"]);
  });

  it("says when the packaging is not clean and sealed", () => {
    const lines = foodSafetyLines(
      makeReport({ checklist: checklist({ packaging_intact: false }) }),
      UTC,
    );
    expect(lines).toContain("Packaging not clean or sealed");
    expect(lines).not.toContain("Packaging clean and sealed");
  });

  it("leaves the packaging line out when it is unknown", () => {
    const lines = foodSafetyLines(
      makeReport({ checklist: checklist({ packaging_intact: null }) }),
      UTC,
    );
    expect(lines.some((line) => line.startsWith("Packaging"))).toBe(false);
  });
});
