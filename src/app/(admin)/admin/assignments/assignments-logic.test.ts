import { describe, expect, it } from "vitest";
import {
  assignFailure,
  availabilityLine,
  detailFailure,
  donationCode,
  filterVolunteers,
  isAwaitingAssignment,
  parseAcceptedListResponse,
  parseDetailResponse,
  parseDonationParam,
  parseVolunteersResponse,
  type VolunteerView,
} from "./assignments-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";
const UTC = "UTC";

describe("donationCode", () => {
  it("writes the first 8 id characters, uppercased, after a hash", () => {
    expect(donationCode(DONATION_ID)).toBe("#9FC03951");
  });

  it("uppercases an already lower-case id", () => {
    expect(donationCode("abcdef12-3333-4444-8555-666677778888")).toBe("#ABCDEF12");
  });

  it("survives an id shorter than 8 characters", () => {
    expect(donationCode("abc")).toBe("#ABC");
  });
});

describe("parseDonationParam", () => {
  it("shows the list when the param is absent", () => {
    expect(parseDonationParam(undefined)).toEqual({ kind: "list" });
  });

  it("shows the detail for a lone uuid, lowercased", () => {
    expect(parseDonationParam(DONATION_ID.toUpperCase())).toEqual({
      kind: "detail",
      donationId: DONATION_ID,
    });
  });

  it("shows not-found for junk instead of falling back to the list", () => {
    expect(parseDonationParam("not-a-uuid")).toEqual({ kind: "not-found" });
  });

  it("shows not-found for an empty param", () => {
    expect(parseDonationParam("")).toEqual({ kind: "not-found" });
  });

  it("shows not-found for a repeated param", () => {
    expect(parseDonationParam([DONATION_ID, DONATION_ID])).toEqual({ kind: "not-found" });
  });
});

function volunteer(overrides: Partial<VolunteerView> = {}): VolunteerView {
  return {
    volunteerId: "11111111-1111-4111-8111-111111111111",
    fullName: "Ana Reyes",
    availability: "Weekday afternoons",
    ...overrides,
  };
}

describe("filterVolunteers", () => {
  const rows = [
    volunteer(),
    volunteer({
      volunteerId: "22222222-2222-4222-8222-222222222222",
      fullName: "Carlo Dela Cruz",
      availability: null,
    }),
    volunteer({
      volunteerId: "33333333-3333-4333-8333-333333333333",
      fullName: "Mika Santos",
      availability: "Weekends",
    }),
  ];

  it("matches case-insensitively", () => {
    expect(filterVolunteers(rows, "ANA")).toEqual([rows[0]]);
    expect(filterVolunteers(rows, "dela")).toEqual([rows[1]]);
  });

  it("trims the search", () => {
    expect(filterVolunteers(rows, "   mika   ")).toEqual([rows[2]]);
  });

  it("returns every row for an empty search", () => {
    expect(filterVolunteers(rows, "")).toEqual(rows);
    expect(filterVolunteers(rows, "   ")).toEqual(rows);
  });

  it("returns nothing when no name matches", () => {
    expect(filterVolunteers(rows, "nobody")).toEqual([]);
  });
});

describe("availabilityLine", () => {
  it("shows only Active when availability is null", () => {
    expect(availabilityLine(null)).toBe("Active");
  });

  it("shows only Active when availability is blank", () => {
    expect(availabilityLine("   ")).toBe("Active");
  });

  it("keeps the static line when availability has a value", () => {
    expect(availabilityLine("Weekends")).toBe("Active · Availability: Weekends");
  });
});

describe("parseAcceptedListResponse", () => {
  const item = {
    donationId: DONATION_ID,
    foodName: "Test bread",
    portions: 24,
    donorName: "Test Donor",
    pickupEnd: "2026-11-04T15:30:00.000Z",
  };

  it("parses the accepted list into view rows with a code and formatted end", () => {
    expect(parseAcceptedListResponse({ donations: [item] }, UTC)).toEqual([
      {
        donationId: DONATION_ID,
        code: "#9FC03951",
        foodName: "Test bread",
        portions: 24,
        donorName: "Test Donor",
        pickupEnd: "4 Nov 2026, 3:30 PM",
      },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseAcceptedListResponse({ donations: [] })).toEqual([]);
  });

  it("refuses a missing key", () => {
    const missing = { ...item };
    delete (missing as Partial<typeof item>).donorName;
    expect(parseAcceptedListResponse({ donations: [missing] })).toBeNull();
  });

  it("refuses a wrong type", () => {
    expect(parseAcceptedListResponse({ donations: [{ ...item, portions: "24" }] })).toBeNull();
    expect(parseAcceptedListResponse({ donations: "none" })).toBeNull();
  });

  it("refuses a body that is not the list shape", () => {
    expect(parseAcceptedListResponse(null)).toBeNull();
    expect(parseAcceptedListResponse("nope")).toBeNull();
    expect(parseAcceptedListResponse([{ ...item }])).toBeNull();
  });
});

describe("parseVolunteersResponse", () => {
  const row = {
    volunteerId: "11111111-1111-4111-8111-111111111111",
    fullName: "Ana Reyes",
    availability: "Weekday afternoons",
  };

  it("parses the volunteer answer into rows", () => {
    expect(parseVolunteersResponse({ volunteers: [row, { ...row, availability: null }] })).toEqual([
      row,
      { ...row, availability: null },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseVolunteersResponse({ volunteers: [] })).toEqual([]);
  });

  it("refuses a missing key", () => {
    const missing = { ...row };
    delete (missing as Partial<typeof row>).fullName;
    expect(parseVolunteersResponse({ volunteers: [missing] })).toBeNull();
  });

  it("refuses a wrong type", () => {
    expect(parseVolunteersResponse({ volunteers: [{ ...row, availability: 5 }] })).toBeNull();
    expect(parseVolunteersResponse({ volunteers: null })).toBeNull();
  });
});

describe("parseDetailResponse", () => {
  const report = {
    donation: {
      id: DONATION_ID,
      food_name: "Test bread",
      category: "Bakery",
      portions: 24,
      status: "ACCEPTED",
      posted_at: "2026-11-03T08:00:00.000Z",
      accepted_at: "2026-11-03T09:00:00.000Z",
      closed_at: null,
    },
    donor: {
      user_id: "44444444-4444-4444-8444-444444444444",
      name: "Test Donor",
      full_name: "Donor Person",
      donor_type: "ESTABLISHMENT",
      phone: "09171234567",
    },
    pickup: {
      address: "10 Market Road, Quezon City",
      pickup_start: "2026-11-04T07:00:00.000Z",
      pickup_end: "2026-11-04T09:00:00.000Z",
    },
  };

  it("parses the header card with formatted window and end", () => {
    expect(parseDetailResponse(report, UTC)).toEqual({
      foodName: "Test bread",
      donorName: "Test Donor",
      portions: 24,
      address: "10 Market Road, Quezon City",
      window: "4 Nov 2026 · 7:00–9:00 AM",
      pickupEnd: "4 Nov 2026, 9:00 AM",
      status: "ACCEPTED",
      hasPickup: true,
    });
  });

  it("never carries the donor phone into the view model", () => {
    const view = parseDetailResponse(report, UTC);
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain("09171234567");
    expect(Object.hasOwn(view as object, "phone")).toBe(false);
    expect(Object.hasOwn(view as object, "donor")).toBe(false);
  });

  it("shows dashes and drops the strip when pickup is null", () => {
    expect(parseDetailResponse({ ...report, pickup: null }, UTC)).toEqual({
      foodName: "Test bread",
      donorName: "Test Donor",
      portions: 24,
      address: "—",
      window: "—",
      pickupEnd: "—",
      status: "ACCEPTED",
      hasPickup: false,
    });
  });

  it("refuses a missing key", () => {
    const missing = { ...report };
    delete (missing as Partial<typeof report>).donor;
    expect(parseDetailResponse(missing)).toBeNull();
    const noFood = { ...report.donation };
    delete (noFood as Partial<typeof report.donation>).food_name;
    expect(parseDetailResponse({ ...report, donation: noFood })).toBeNull();
  });

  it("refuses a wrong type", () => {
    expect(parseDetailResponse({ ...report, donation: { ...report.donation, portions: "24" } })).toBeNull();
    expect(parseDetailResponse({ ...report, pickup: "soon" })).toBeNull();
  });

  it("refuses a body that is not an object", () => {
    expect(parseDetailResponse(null)).toBeNull();
    expect(parseDetailResponse("report")).toBeNull();
    expect(parseDetailResponse([])).toBeNull();
  });
});

describe("isAwaitingAssignment", () => {
  it("accepts only ACCEPTED", () => {
    expect(isAwaitingAssignment("ACCEPTED")).toBe(true);
  });

  it("refuses every other status", () => {
    expect(isAwaitingAssignment("ASSIGNED")).toBe(false);
    expect(isAwaitingAssignment("POSTED")).toBe(false);
    expect(isAwaitingAssignment("CLOSED")).toBe(false);
    expect(isAwaitingAssignment("WEIRD_STATUS")).toBe(false);
  });
});

describe("detailFailure", () => {
  it("treats only a 404 as not found", () => {
    expect(detailFailure(404)).toBe("not-found");
  });

  it("treats every other refusal as a retryable error", () => {
    expect(detailFailure(400)).toBe("error");
    expect(detailFailure(401)).toBe("error");
    expect(detailFailure(403)).toBe("error");
    expect(detailFailure(500)).toBe("error");
  });

  it("treats a network failure, timeout or bad body (no status) as a retryable error", () => {
    expect(detailFailure(null)).toBe("error");
  });
});

describe("assignFailure", () => {
  it("maps 422 to the inactive-volunteer message with a volunteer reload", () => {
    const view = assignFailure(422);
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("Volunteer not available");
    expect(view.message).toContain("no longer active");
    expect(view.action).toBe("reload-volunteers");
  });

  it("maps 409 to the changed-donation message with a detail reload", () => {
    const view = assignFailure(409);
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("Donation changed");
    expect(view.message).toContain("pickup window has passed");
    expect(view.action).toBe("reload-detail");
  });

  it("maps 404 to a not-found refusal with no follow-up", () => {
    const view = assignFailure(404);
    expect(view.tone).toBe("warning");
    expect(view.title).toBe("Donation not found");
    expect(view.message).toContain("could not be found");
    expect(view.action).toBe("none");
  });

  it("maps 401 and 403 to the generic save failure", () => {
    for (const status of [401, 403]) {
      const view = assignFailure(status);
      expect(view.tone).toBe("error");
      expect(view.title).toBe("Assignment not saved");
      expect(view.message).toContain("could not be saved");
      expect(view.action).toBe("none");
    }
  });

  it("maps 400, 500 and any other status to the generic save failure", () => {
    for (const status of [400, 500, 0]) {
      const view = assignFailure(status);
      expect(view.tone).toBe("error");
      expect(view.title).toBe("Assignment not saved");
      expect(view.message).toContain("Try again");
      expect(view.action).toBe("none");
    }
  });
});
