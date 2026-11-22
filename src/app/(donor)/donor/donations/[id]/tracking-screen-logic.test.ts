import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type { TrackingReport } from "./tracking-logic";
import {
  CANCEL_FAILURE_MESSAGE,
  classifyCancel,
  classifyLoad,
  labelPickupLines,
  pickupAddress,
} from "./tracking-screen-logic";

/** The smallest report classifyLoad can be handed; the shape comes from tracking-logic. */
function report(): TrackingReport {
  return {
    donation: {
      status: DonationStatus.POSTED,
      food_name: "Test bread",
      category: "Bakery",
      portions: 24,
      closed_at: null,
    },
    volunteer: null,
    pickup: null,
    safety_checklist: null,
    allergens: null,
    exit: null,
    distribution: { entries: null },
    impact: { portions_donated: null, portions_distributed: null },
    timeline: null,
  };
}

describe("classifyLoad", () => {
  it("reads 404 and 400 as not found", () => {
    expect(classifyLoad(404, null)).toEqual({ kind: "not-found" });
    expect(classifyLoad(400, null)).toEqual({ kind: "not-found" });
  });

  it("reads 404 as not found even when a report arrived", () => {
    expect(classifyLoad(404, report())).toEqual({ kind: "not-found" });
  });

  it("is ready on a 2xx answer that carries a report", () => {
    const parsed = report();
    expect(classifyLoad(200, parsed)).toEqual({ kind: "ready", report: parsed });
  });

  it("is an error when a 2xx answer carries no report", () => {
    expect(classifyLoad(200, null)).toEqual({ kind: "error" });
  });

  it("is an error for every other status, including auth failures", () => {
    for (const status of [401, 403, 409, 500, 503]) {
      expect(classifyLoad(status, report())).toEqual({ kind: "error" });
    }
  });

  it("is an error when the request never completed", () => {
    expect(classifyLoad(null, null)).toEqual({ kind: "error" });
  });
});

describe("classifyCancel", () => {
  it("is ok on a 2xx status", () => {
    expect(classifyCancel(200, { donationId: "x", status: "CANCELLED" })).toEqual({ kind: "ok" });
  });

  it("refuses 409 NOT_CANCELLABLE with the written message", () => {
    expect(classifyCancel(409, { error: "NOT_CANCELLABLE", message: "server wording" })).toEqual({
      kind: "refused",
      message: "This donation can no longer be cancelled.",
    });
  });

  it("is the generic error for a 409 with any other code", () => {
    expect(classifyCancel(409, { error: "CONFLICT", message: "server wording" })).toEqual({
      kind: "error",
      message: CANCEL_FAILURE_MESSAGE,
    });
  });

  it("is the generic error for a 409 whose body cannot be read", () => {
    expect(classifyCancel(409, null)).toEqual({ kind: "error", message: CANCEL_FAILURE_MESSAGE });
    expect(classifyCancel(409, "not an object")).toEqual({
      kind: "error",
      message: CANCEL_FAILURE_MESSAGE,
    });
    expect(classifyCancel(409, { error: 42 })).toEqual({
      kind: "error",
      message: CANCEL_FAILURE_MESSAGE,
    });
  });

  it("is the generic error for every other failure status", () => {
    for (const status of [400, 401, 403, 404, 500]) {
      expect(classifyCancel(status, null)).toEqual({
        kind: "error",
        message: CANCEL_FAILURE_MESSAGE,
      });
    }
  });

  it("is the generic error when the request never completed", () => {
    expect(classifyCancel(null, null)).toEqual({ kind: "error", message: CANCEL_FAILURE_MESSAGE });
  });

  it("answers a server failure with our own message, never its text", () => {
    // The toEqual below proves it: the outcome message is ours, not "raw database text".
    expect(
      classifyCancel(500, { error: "INTERNAL_ERROR", message: "raw database text" }),
    ).toEqual({ kind: "error", message: CANCEL_FAILURE_MESSAGE });
  });
});

describe("pickupAddress", () => {
  it("reads and trims the address from the pickup", () => {
    const pickup = {
      pickup_start: null,
      pickup_end: null,
      address: "  18 Mabini Street, Quezon City  ",
    };
    expect(pickupAddress(pickup)).toBe("18 Mabini Street, Quezon City");
  });

  it("is null without a pickup", () => {
    expect(pickupAddress(null)).toBeNull();
  });

  it("is null when the address is missing or not text", () => {
    expect(pickupAddress({ pickup_start: null, pickup_end: null })).toBeNull();
    expect(pickupAddress({ pickup_start: null, pickup_end: null, address: null })).toBeNull();
    expect(pickupAddress({ pickup_start: null, pickup_end: null, address: 18 })).toBeNull();
  });

  it("is null when the address is blank", () => {
    expect(pickupAddress({ pickup_start: null, pickup_end: null, address: "   " })).toBeNull();
  });
});

describe("labelPickupLines", () => {
  it("puts the window first and the address second, like the review step", () => {
    expect(labelPickupLines("4 Nov 2026 · 7:00–9:00 AM", "18 Mabini Street")).toEqual([
      "4 Nov 2026 · 7:00–9:00 AM",
      "18 Mabini Street",
    ]);
  });

  it("keeps whichever line exists", () => {
    expect(labelPickupLines(null, "18 Mabini Street")).toEqual(["18 Mabini Street"]);
    expect(labelPickupLines("4 Nov 2026 · 7:00–9:00 AM", null)).toEqual([
      "4 Nov 2026 · 7:00–9:00 AM",
    ]);
  });

  it("drops blank lines and is empty when nothing is known", () => {
    expect(labelPickupLines("   ", null)).toEqual([]);
    expect(labelPickupLines(null, " ")).toEqual([]);
    expect(labelPickupLines(null, null)).toEqual([]);
  });
});
