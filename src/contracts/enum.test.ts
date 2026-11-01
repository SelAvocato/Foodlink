import { describe, expect, it } from "vitest";
import { DonationStatus, Role } from "@/contracts/enums";

describe("contracts/enums", () => {
  it("has the 13 donation statuses from the System Structure", () => {
    expect(Object.values(DonationStatus).sort()).toEqual(
      [
        "ACCEPTED", "ASSIGNED", "CANCELLED", "CLOSED", "DECLINED", "DELIVERED",
        "DRAFT", "EXPIRED", "PICKED_UP", "POSTED", "REJECTED",
        "REJECTED_AT_PICKUP", "SCREENED",
      ].sort(),
    );
  });

  it("has no Receiver role", () => {
    expect(Object.values(Role)).toEqual(["DONOR", "VOLUNTEER", "ADMIN"]);
  });

  it("uses the same string for every key and value", () => {
    for (const [key, value] of Object.entries(DonationStatus)) {
      expect(value).toBe(key);
    }
  });
});