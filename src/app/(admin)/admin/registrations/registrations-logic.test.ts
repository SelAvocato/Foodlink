import { describe, expect, it } from "vitest";
import {
  filterByTab,
  formatConsent,
  joinAddress,
  parseApplicants,
  proofCardTitle,
  readSignedUrl,
  relativeDayLabel,
  reviewMessage,
  tabCounts,
  typeLabel,
  validateReason,
  type Applicant,
} from "./registrations-logic";

/** 12:00 in Manila on Sun 15 Nov 2026. */
const NOW = new Date("2026-11-15T04:00:00.000Z");

function applicant(patch: Partial<Applicant> = {}): Applicant {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    role: "DONOR",
    fullName: "Test Donor",
    email: "donor@example.com",
    createdAt: "2026-11-15T01:00:00.000Z",
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery",
    address: {
      streetLine1: "12 Test Street",
      streetLine2: null,
      barangay: "Barangay Test",
      city: "Test City",
    },
    privacyConsentAt: "2026-11-04T01:04:00.000Z",
    documents: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "BUSINESS_PERMIT",
        status: "PENDING",
        mimeType: "image/png",
        sizeBytes: 2048,
        createdAt: "2026-11-15T01:00:00.000Z",
      },
    ],
    ...patch,
  };
}

/** A raw API user as JSON, so parseApplicants sees the real body shape. */
function rawUser(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    role: "DONOR",
    fullName: "Test Donor",
    email: "donor@example.com",
    createdAt: "2026-11-15T01:00:00.000Z",
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery",
    address: {
      streetLine1: "12 Test Street",
      streetLine2: null,
      barangay: "Barangay Test",
      city: "Test City",
    },
    privacyConsentAt: "2026-11-04T01:04:00.000Z",
    documents: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "BUSINESS_PERMIT",
        status: "PENDING",
        mimeType: "image/png",
        sizeBytes: 2048,
        createdAt: "2026-11-15T01:00:00.000Z",
      },
    ],
    ...patch,
  };
}

const volunteer = applicant({
  id: "33333333-3333-4333-8333-333333333333",
  role: "VOLUNTEER",
  fullName: "Test Volunteer",
  email: "volunteer@example.com",
  donorType: null,
  businessName: null,
});

describe("parseApplicants", () => {
  it("returns the users of a valid response", () => {
    const users = parseApplicants({ users: [rawUser()] });
    expect(users).not.toBeNull();
    expect(users).toHaveLength(1);
    expect(users?.[0]).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      role: "DONOR",
      email: "donor@example.com",
      privacyConsentAt: "2026-11-04T01:04:00.000Z",
    });
    expect(users?.[0].documents[0]).toMatchObject({ type: "BUSINESS_PERMIT" });
  });

  it("returns null for null, a string and an object without users", () => {
    expect(parseApplicants(null)).toBeNull();
    expect(parseApplicants("users")).toBeNull();
    expect(parseApplicants({})).toBeNull();
  });

  it("returns null when a user carries an unknown field", () => {
    expect(parseApplicants({ users: [rawUser({ status: "PENDING" })] })).toBeNull();
  });

  it("returns null for an unknown role, an unknown donorType or a broken date", () => {
    expect(parseApplicants({ users: [rawUser({ role: "RECEIVER" })] })).toBeNull();
    expect(parseApplicants({ users: [rawUser({ donorType: "ESTABLISHED" })] })).toBeNull();
    expect(parseApplicants({ users: [rawUser({ createdAt: "yesterday" })] })).toBeNull();
  });

  it("returns null when a document is missing a field", () => {
    const broken = rawUser({ documents: [{ id: "22222222-2222-4222-8222-222222222222" }] });
    expect(parseApplicants({ users: [broken] })).toBeNull();
  });

  it("accepts a null address, a null consent time and no documents", () => {
    const user = rawUser({ address: null, privacyConsentAt: null, documents: [] });
    const users = parseApplicants({ users: [user] });
    expect(users).not.toBeNull();
    expect(users?.[0].address).toBeNull();
    expect(users?.[0].privacyConsentAt).toBeNull();
    expect(users?.[0].documents).toEqual([]);
  });
});

describe("filterByTab", () => {
  const list = [applicant(), volunteer, applicant({ id: "44444444-4444-4444-8444-444444444444" })];

  it("keeps the whole list on Pending", () => {
    expect(filterByTab(list, "pending")).toEqual(list);
  });

  it("keeps only donors on Donors", () => {
    const donors = filterByTab(list, "donors");
    expect(donors).toHaveLength(2);
    expect(donors.every((a) => a.role === "DONOR")).toBe(true);
  });

  it("keeps only volunteers on Volunteers", () => {
    const volunteers = filterByTab(list, "volunteers");
    expect(volunteers).toEqual([volunteer]);
  });

  it("returns an empty list for an empty list", () => {
    expect(filterByTab([], "pending")).toEqual([]);
    expect(filterByTab([], "donors")).toEqual([]);
    expect(filterByTab([], "volunteers")).toEqual([]);
  });
});

describe("tabCounts", () => {
  it("counts the list and both roles", () => {
    const list = [applicant(), volunteer, applicant({ id: "44444444-4444-4444-8444-444444444444" })];
    expect(tabCounts(list)).toEqual({ pending: 3, donors: 2, volunteers: 1 });
  });

  it("counts nothing for an empty list", () => {
    expect(tabCounts([])).toEqual({ pending: 0, donors: 0, volunteers: 0 });
  });
});

describe("relativeDayLabel", () => {
  it("labels a timestamp of the same Manila day as Today", () => {
    expect(relativeDayLabel("2026-11-15T01:00:00.000Z", NOW)).toBe("Today");
  });

  it("labels 16:00Z of the previous UTC day as Today when Manila already turned", () => {
    // 14 Nov 16:00Z is 15 Nov 00:00 in Manila; NOW is 15 Nov 12:00 Manila.
    expect(relativeDayLabel("2026-11-14T16:00:00.000Z", NOW)).toBe("Today");
  });

  it("labels the previous Manila day as Yesterday", () => {
    expect(relativeDayLabel("2026-11-14T01:00:00.000Z", NOW)).toBe("Yesterday");
    expect(relativeDayLabel("2026-11-14T15:59:00.000Z", NOW)).toBe("Yesterday");
  });

  it("labels an older date day-first", () => {
    expect(relativeDayLabel("2026-11-04T01:04:00.000Z", NOW)).toBe("4 Nov 2026");
  });

  it("compares in Manila, not in UTC", () => {
    // 14 Nov 23:00Z is already 15 Nov 07:00 in Manila; the UTC date would say yesterday.
    const now = new Date("2026-11-15T00:30:00.000Z");
    expect(relativeDayLabel("2026-11-14T23:00:00.000Z", now)).toBe("Today");
  });
});

describe("typeLabel", () => {
  it("labels both donor types", () => {
    expect(typeLabel("DONOR", "ESTABLISHMENT")).toBe("Establishment donor");
    expect(typeLabel("DONOR", "INDIVIDUAL")).toBe("Individual donor");
  });

  it("labels a volunteer", () => {
    expect(typeLabel("VOLUNTEER", null)).toBe("Volunteer");
  });

  it("labels a donor without a donorType", () => {
    expect(typeLabel("DONOR", null)).toBe("Donor");
  });

  it("labels an admin without inventing a donor type", () => {
    expect(typeLabel("ADMIN", null)).toBe("Admin");
  });
});

describe("joinAddress", () => {
  it("joins all four parts with commas", () => {
    expect(
      joinAddress({
        streetLine1: "12 Test Street",
        streetLine2: "Unit 4",
        barangay: "Barangay Test",
        city: "Test City",
      }),
    ).toBe("12 Test Street, Unit 4, Barangay Test, Test City");
  });

  it("skips empty parts", () => {
    expect(
      joinAddress({
        streetLine1: "12 Test Street",
        streetLine2: null,
        barangay: "  ",
        city: "Test City",
      }),
    ).toBe("12 Test Street, Test City");
  });

  it("says Not provided for a null address", () => {
    expect(joinAddress(null)).toBe("Not provided");
  });

  it("says Not provided when every part is empty", () => {
    expect(
      joinAddress({ streetLine1: "", streetLine2: null, barangay: "", city: "" }),
    ).toBe("Not provided");
  });
});

describe("formatConsent", () => {
  it("formats like the static layer, day first, in Manila time", () => {
    expect(formatConsent("2026-11-04T01:04:00.000Z")).toBe("4 Nov 2026, 9:04 AM");
  });

  it("says Not recorded for null", () => {
    expect(formatConsent(null)).toBe("Not recorded");
  });
});

describe("proofCardTitle", () => {
  it("maps both document codes", () => {
    expect(proofCardTitle("BUSINESS_PERMIT")).toBe("Business permit");
    expect(proofCardTitle("VALID_ID")).toBe("Valid government ID");
  });

  it("falls back for an unknown code", () => {
    expect(proofCardTitle("SOMETHING_NEW")).toBe("Proof document");
  });

  it("falls back for inherited property names", () => {
    expect(proofCardTitle("__proto__")).toBe("Proof document");
    expect(proofCardTitle("constructor")).toBe("Proof document");
  });
});

describe("reviewMessage", () => {
  it("maps NOT_FOUND to a short message and a reload", () => {
    expect(reviewMessage(404, { error: "NOT_FOUND", message: "The account was not found." })).toEqual({
      message: "This application is no longer pending.",
      reload: true,
    });
  });

  it("maps a 404 without a readable body to the same message", () => {
    expect(reviewMessage(404, null)).toEqual({
      message: "This application is no longer pending.",
      reload: true,
    });
  });

  it("maps INVALID_TRANSITION to a short message and a reload", () => {
    expect(reviewMessage(409, { error: "INVALID_TRANSITION" })).toEqual({
      message: "This application has already been reviewed.",
      reload: true,
    });
  });

  it("maps a 409 without a readable body to the same message", () => {
    expect(reviewMessage(409, undefined)).toEqual({
      message: "This application has already been reviewed.",
      reload: true,
    });
  });

  it("maps INVALID_REQUEST to its own message without a reload", () => {
    expect(reviewMessage(400, { error: "INVALID_REQUEST" })).toEqual({
      message: "The request was not valid. Please try again.",
      reload: false,
    });
    expect(reviewMessage(400, null).reload).toBe(false);
  });

  it("maps TARGET_NOT_REVIEWABLE to the generic message", () => {
    expect(reviewMessage(403, { error: "TARGET_NOT_REVIEWABLE" })).toEqual({
      message: "Something went wrong. Please try again.",
      reload: false,
    });
  });

  it("maps INTERNAL_ERROR and an unreadable body to the generic message", () => {
    expect(reviewMessage(500, { error: "INTERNAL_ERROR" })).toEqual({
      message: "Something went wrong. Please try again.",
      reload: false,
    });
    expect(reviewMessage(500, "not json").message).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

describe("validateReason", () => {
  it("accepts a plain reason and trims it", () => {
    expect(validateReason("  Test reason  ")).toEqual({ ok: true, reason: "Test reason" });
  });

  it("refuses an empty reason", () => {
    expect(validateReason("")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("refuses a whitespace-only reason", () => {
    expect(validateReason("   \n  ")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("refuses a reason that strips to nothing", () => {
    expect(validateReason("<>")).toEqual({ ok: false, message: "Enter a reason" });
  });

  it("accepts exactly 500 characters", () => {
    expect(validateReason("x".repeat(500))).toEqual({ ok: true, reason: "x".repeat(500) });
  });

  it("refuses 501 characters", () => {
    expect(validateReason("x".repeat(501))).toEqual({
      ok: false,
      message: "Use at most 500 characters",
    });
  });
});

describe("readSignedUrl", () => {
  it("reads the url of a valid answer", () => {
    const url = "https://example.com/proof.png?sig=test";
    expect(readSignedUrl({ url, expiresInSeconds: 300 })).toBe(url);
  });

  it("refuses a missing, empty or non-string url", () => {
    expect(readSignedUrl({ expiresInSeconds: 300 })).toBeNull();
    expect(readSignedUrl({ url: "" })).toBeNull();
    expect(readSignedUrl({ url: 42 })).toBeNull();
    expect(readSignedUrl(null)).toBeNull();
    expect(readSignedUrl("url")).toBeNull();
  });

  it("refuses a url that is not http(s)", () => {
    expect(readSignedUrl({ url: "javascript:alert(1)" })).toBeNull();
    expect(readSignedUrl({ url: "not a url" })).toBeNull();
  });
});
