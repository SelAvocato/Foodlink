import { describe, expect, it } from "vitest";
import { DonationStatus } from "./enums";
import {
  VOLUNTEER_DONATION_STATUSES,
  volunteerDonationListQuerySchema,
} from "./volunteer-donation-list";

function parse(query: Record<string, string> = {}) {
  return volunteerDonationListQuerySchema.safeParse(query);
}

function parseOk(query: Record<string, string> = {}) {
  const parsed = parse(query);
  if (!parsed.success) throw new Error("Expected the query to be valid");
  return parsed.data;
}

describe("volunteerDonationListQuerySchema", () => {
  it("defaults to page 1, 20 per page and no status", () => {
    expect(parseOk()).toEqual({ page: 1, pageSize: 20 });
  });

  it.each(VOLUNTEER_DONATION_STATUSES)("accepts the status %s", (status) => {
    expect(parseOk({ status }).status).toBe(status);
  });

  it.each(["POSTED", "ACCEPTED", "CLOSED", "LOST"])("rejects the status %s", (status) => {
    expect(parse({ status }).success).toBe(false);
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

  it.each(["volunteerId", "q", "tab", "counts", "donorId"])(
    "rejects the unknown key %s",
    (key) => {
      expect(parse({ [key]: "x" }).success).toBe(false);
    },
  );

  it("contains exactly the three allowed statuses", () => {
    expect(VOLUNTEER_DONATION_STATUSES).toEqual([
      DonationStatus.ASSIGNED,
      DonationStatus.PICKED_UP,
      DonationStatus.DELIVERED,
    ]);
  });
});
