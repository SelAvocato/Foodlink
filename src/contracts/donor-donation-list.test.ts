import { describe, expect, it } from "vitest";
import {
  DONOR_DONATION_TAB_STATUSES,
  donorDonationListQuerySchema,
  donorDonationTabs,
} from "./donor-donation-list";
import { DonationStatus } from "./enums";

function parse(query: Record<string, string> = {}) {
  return donorDonationListQuerySchema.safeParse(query);
}

/** The parsed query of a valid one; the schema's refinement makes data optional on the result. */
function parseOk(query: Record<string, string> = {}) {
  const parsed = parse(query);
  if (!parsed.success) throw new Error("Expected the query to be valid");
  return parsed.data;
}

describe("donorDonationListQuerySchema", () => {
  it("defaults to the active tab, page 1 and 20 per page", () => {
    expect(parseOk()).toEqual({ tab: "active", page: 1, pageSize: 20 });
  });

  it("accepts a search with no filter and no status", () => {
    const query = parseOk({ q: "adobo" });

    expect(query.q).toBe("adobo");
    expect(query.status).toBeUndefined();
  });

  it.each(["0", "-1", "10001", "1.5", "abc", ""])("rejects the page %j", (page) => {
    expect(parse({ page }).success).toBe(false);
  });

  it.each(["1", "2", "10000"])("accepts the page %j", (page) => {
    expect(parse({ page }).success).toBe(true);
  });

  it.each(["0", "-1", "51", "2.5", "abc", ""])("rejects the page size %j", (pageSize) => {
    expect(parse({ pageSize }).success).toBe(false);
  });

  it.each(["1", "20", "50"])("accepts the page size %j", (pageSize) => {
    expect(parse({ pageSize }).success).toBe(true);
  });

  it("accepts 100 characters of search and rejects 101", () => {
    expect(parse({ q: "a".repeat(100) }).success).toBe(true);
    expect(parse({ q: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects an unknown key such as donorId", () => {
    const parsed = parse({ donorId: "11111111-1111-4111-8111-111111111111" });

    expect(parsed.success).toBe(false);
  });

  it.each(["tab", "sort", "offset", "counts"])("rejects the unknown key %s", (key) => {
    expect(parse({ [key]: "x" }).success).toBe(false);
  });

  it("rejects a status that does not belong to the chosen tab", () => {
    const parsed = parse({ tab: "drafts", status: "POSTED" });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["status"]);
    }
  });

  it("accepts a status that belongs to the chosen tab", () => {
    expect(parseOk({ tab: "drafts", status: "SCREENED" })).toMatchObject({
      tab: "drafts",
      status: "SCREENED",
    });
  });

  it("rejects an unknown status", () => {
    expect(parse({ status: "LOST" }).success).toBe(false);
  });

  it('removes a leading "#" from the search', () => {
    expect(parseOk({ q: "  #abc123  " }).q).toBe("abc123");
  });

  it("does not count the removed # against the length limit", () => {
    const hundred = "a".repeat(100);

    expect(parse({ q: `#${hundred}` }).success).toBe(true);
  });

  it.each(["", "   ", "#", " # "])("turns the blank search %j into undefined", (q) => {
    expect(parseOk({ q }).q).toBeUndefined();
  });

  it("keeps every DonationStatus value in exactly one tab", () => {
    const grouped = donorDonationTabs.flatMap((tab) => DONOR_DONATION_TAB_STATUSES[tab]);
    const allStatuses = Object.values(DonationStatus);

    // All 13 statuses from the database enum, none twice, none missing.
    expect(allStatuses).toHaveLength(13);
    expect(grouped).toHaveLength(allStatuses.length);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...allStatuses].sort());
  });
});
