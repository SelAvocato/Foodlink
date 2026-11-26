import { describe, expect, it } from "vitest";
import { countCards, formatActivityTime, parseDashboardResponse } from "./command-center-logic";

describe("command-center logic", () => {
  it("parses a valid dashboard response", () => {
    const parsed = parseDashboardResponse({
      counts: { pendingRegistrations: 1, screeningReviews: 0, postedDonations: 2, acceptedAwaitingAssignment: 3 },
      recentActivity: [{
        id: "registration:1",
        type: "REGISTRATION",
        title: "Donor registration pending",
        detail: "Ana",
        occurredAt: "2026-11-25T08:00:00.000Z",
        href: "/admin/registrations",
      }],
    });
    expect(parsed?.counts.postedDonations).toBe(2);
  });

  it("returns null for invalid response", () => {
    expect(parseDashboardResponse({ counts: {} })).toBeNull();
  });

  it("formats activity time and handles invalid date", () => {
    expect(formatActivityTime("2026-11-25T08:00:00.000Z")).toContain("2026");
    expect(formatActivityTime("bad-date")).toBe("Unknown time");
  });

  it("builds count cards with attention for actionable counts", () => {
    const cards = countCards({ pendingRegistrations: 1, screeningReviews: 0, postedDonations: 2, acceptedAwaitingAssignment: 1 });
    expect(cards.find((c) => c.label === "Pending registrations")?.variant).toBe("attention");
    expect(cards.find((c) => c.label === "Screening reviews")?.variant).toBe("default");
  });
});
