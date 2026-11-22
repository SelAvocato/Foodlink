import { describe, expect, it } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import type { DonationListItemJson } from "@/app/(donor)/donor/donations/donations-logic";
import { firstName, greetingFor, pickupStrip, profileFirstName } from "./overview-logic";

function item(overrides: Partial<DonationListItemJson> = {}): DonationListItemJson {
  return {
    donationId: "9fc03951-0000-4000-8000-000000000001",
    shortCode: "9FC03951",
    foodName: "Test bread",
    category: "Bakery",
    portions: 24,
    status: DonationStatus.POSTED,
    pickupStart: "2026-11-20T13:00:00.000Z",
    pickupEnd: "2026-11-20T14:15:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    checklistComplete: true,
    ...overrides,
  };
}

const NOW = new Date("2026-11-20T12:00:00.000Z");

describe("greetingFor", () => {
  it("says good morning from 0 to 11", () => {
    expect(greetingFor(0)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
  });

  it("says good afternoon from 12 to 17", () => {
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good afternoon");
  });

  it("says good evening from 18 to 23", () => {
    expect(greetingFor(18)).toBe("Good evening");
    expect(greetingFor(23)).toBe("Good evening");
  });

  it("falls back to hello for any other hour", () => {
    expect(greetingFor(Number.NaN)).toBe("Hello");
    expect(greetingFor(-1)).toBe("Hello");
    expect(greetingFor(-24)).toBe("Hello");
    expect(greetingFor(24)).toBe("Hello");
    expect(greetingFor(99)).toBe("Hello");
    expect(greetingFor(Number.POSITIVE_INFINITY)).toBe("Hello");
  });
});

describe("firstName", () => {
  it("takes the first word of a full name", () => {
    expect(firstName("Maria Santos")).toBe("Maria");
  });

  it("trims the name before taking the first word", () => {
    expect(firstName("   Maria   Santos  ")).toBe("Maria");
    expect(firstName("Maria")).toBe("Maria");
  });

  it("returns null when there is no name", () => {
    expect(firstName("")).toBeNull();
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
  });
});

describe("profileFirstName", () => {
  it("reads the first name from the profile body", () => {
    expect(profileFirstName({ profile: { fullName: "Maria Santos", businessName: "Maria's Cafe" } })).toBe(
      "Maria",
    );
  });

  it("returns null when the profile is missing or not an object", () => {
    expect(profileFirstName({})).toBeNull();
    expect(profileFirstName({ profile: null })).toBeNull();
    expect(profileFirstName(null)).toBeNull();
    expect(profileFirstName("not-json")).toBeNull();
  });

  it("returns null when the full name is missing or not a string", () => {
    expect(profileFirstName({ profile: {} })).toBeNull();
    expect(profileFirstName({ profile: { fullName: 42 } })).toBeNull();
    expect(profileFirstName({ profile: { fullName: null } })).toBeNull();
  });

  it("returns null for an empty or whitespace-only name", () => {
    expect(profileFirstName({ profile: { fullName: "" } })).toBeNull();
    expect(profileFirstName({ profile: { fullName: "   " } })).toBeNull();
  });
});

describe("pickupStrip", () => {
  it("returns null for an empty list", () => {
    expect(pickupStrip([], NOW)).toBeNull();
  });

  it("writes the countdown without its prefix and the code with one hash", () => {
    expect(pickupStrip([item()], NOW)).toBe("Pickup ends in 2h 15m for #9FC03951.");
  });

  it("does not double a hash the short code already has", () => {
    expect(pickupStrip([item({ shortCode: "#9FC03951" })], NOW)).toBe(
      "Pickup ends in 2h 15m for #9FC03951.",
    );
  });

  it("adds the storage sentence only for an assigned donation", () => {
    expect(pickupStrip([item({ status: DonationStatus.ASSIGNED })], NOW)).toBe(
      "Pickup ends in 2h 15m for #9FC03951. Keep the food safely stored until the volunteer arrives.",
    );
    expect(pickupStrip([item({ status: DonationStatus.ACCEPTED })], NOW)).not.toContain(
      "Keep the food safely stored",
    );
  });

  it("skips a donation that is not posted, accepted or assigned", () => {
    const qualifying: readonly string[] = [
      DonationStatus.POSTED,
      DonationStatus.ACCEPTED,
      DonationStatus.ASSIGNED,
    ];
    for (const status of Object.values(DonationStatus)) {
      const qualifies = qualifying.includes(status);
      const strip = pickupStrip([item({ status })], NOW);
      if (qualifies) {
        expect(strip).not.toBeNull();
      } else {
        expect(strip).toBeNull();
      }
    }
  });

  it("skips a picked up donation even though its window is open", () => {
    expect(pickupStrip([item({ status: DonationStatus.PICKED_UP })], NOW)).toBeNull();
  });

  it("returns null once the pickup window has ended", () => {
    expect(pickupStrip([item({ pickupEnd: "2026-11-20T11:59:00.000Z" })], NOW)).toBeNull();
    expect(pickupStrip([item({ pickupEnd: "2026-11-20T12:00:00.000Z" })], NOW)).toBeNull();
  });

  it("returns null when the pickup is more than 24 hours away", () => {
    expect(pickupStrip([item({ pickupEnd: "2026-11-21T12:01:00.000Z" })], NOW)).toBeNull();
  });

  it("includes a pickup exactly 24 hours away", () => {
    expect(pickupStrip([item({ pickupEnd: "2026-11-21T12:00:00.000Z" })], NOW)).toBe(
      "Pickup ends in 1d for #9FC03951.",
    );
  });

  it("skips an item with a missing or unreadable pickup end", () => {
    expect(pickupStrip([item({ pickupEnd: null })], NOW)).toBeNull();
    expect(pickupStrip([item({ pickupEnd: "not-a-date" })], NOW)).toBeNull();
    expect(
      pickupStrip([item({ pickupEnd: "not-a-date" }), item({ pickupEnd: "2026-11-20T14:15:00.000Z" })], NOW),
    ).toBe("Pickup ends in 2h 15m for #9FC03951.");
  });

  it("picks the soonest end among the qualifying items", () => {
    const strip = pickupStrip(
      [
        item({ shortCode: "LATER", pickupEnd: "2026-11-20T15:00:00.000Z" }),
        item({ shortCode: "SOONEST", pickupEnd: "2026-11-20T13:00:00.000Z" }),
        item({ shortCode: "PAST", pickupEnd: "2026-11-20T10:00:00.000Z" }),
        item({ shortCode: "FAR", pickupEnd: "2026-11-22T12:00:00.000Z" }),
      ],
      NOW,
    );
    expect(strip).toBe("Pickup ends in 1h for #SOONEST.");
  });

  it("returns null for an unreadable now", () => {
    expect(pickupStrip([item()], new Date("not-a-date"))).toBeNull();
  });
});
