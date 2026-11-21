import { describe, expect, it } from "vitest";
import {
  buildPeopleQuery,
  DEFAULT_PAGE_SIZE,
  donorTypeLabel,
  mapReviewError,
  pageCount,
  rangeSummary,
  roleLabel,
  statusLabel,
  validateSuspendReason,
  type PeopleViewState,
} from "./people-logic";

const baseState: PeopleViewState = {
  role: "DONOR",
  status: "ALL",
  type: "ALL",
  q: "",
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

describe("buildPeopleQuery", () => {
  it("trims the search and keeps the selected filters and pagination", () => {
    expect(buildPeopleQuery({ ...baseState, q: "  Ana Reyes  ", page: 3, pageSize: 10 })).toEqual({
      role: "DONOR",
      status: "ALL",
      type: "ALL",
      q: "Ana Reyes",
      page: 3,
      pageSize: 10,
    });
  });

  it("drops the donor type filter on the volunteer tab", () => {
    expect(buildPeopleQuery({ ...baseState, role: "VOLUNTEER", type: "INDIVIDUAL" })).toMatchObject({
      role: "VOLUNTEER",
      type: "ALL",
    });
  });

  it("clamps invalid values to safe query values", () => {
    expect(buildPeopleQuery({ ...baseState, page: -4, pageSize: 500, q: "x".repeat(120) })).toMatchObject({
      page: 1,
      pageSize: 50,
      q: "x".repeat(100),
    });
  });
});

describe("validateSuspendReason", () => {
  it("requires a trimmed reason and limits its length", () => {
    expect(validateSuspendReason("   ")).toContain("reason");
    expect(validateSuspendReason("x".repeat(501))).toContain("500");
    expect(validateSuspendReason("  Duplicate account  ")).toBeUndefined();
  });
});

describe("mapReviewError", () => {
  it("maps session, validation, conflict and generic failures", () => {
    expect(mapReviewError(401)).toContain("Sign in");
    expect(mapReviewError(400, "INVALID_REQUEST")).toContain("reason");
    expect(mapReviewError(409, "INVALID_TRANSITION")).toContain("Refresh");
    expect(mapReviewError(500)).toContain("Try again");
  });
});

describe("pagination and labels", () => {
  it("computes page counts and ranges", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(41, 20)).toBe(3);
    expect(rangeSummary(0, 1, 20)).toBe("No results");
    expect(rangeSummary(41, 2, 20)).toBe("Showing 21–40 of 41");
  });

  it("uses written labels instead of bare enum values", () => {
    expect(statusLabel("ACTIVE")).toBe("Active");
    expect(donorTypeLabel("ESTABLISHMENT")).toBe("Establishment");
    expect(donorTypeLabel(null)).toBe("Volunteer");
    expect(roleLabel("DONOR")).toBe("Donor");
  });
});
