import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminDashboardQuerySchema,
  adminDashboardResponseSchema,
} from "./admin-dashboard";

describe("adminDashboardQuerySchema", () => {
  it("accepts an empty query", () => {
    expect(adminDashboardQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown query fields", () => {
    const result = adminDashboardQuerySchema.safeParse({ limit: "10" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(z.flattenError(result.error).formErrors.join(" ")).toContain("limit");
    }
  });
});

describe("adminDashboardResponseSchema", () => {
  it("accepts a valid dashboard response", () => {
    const result = adminDashboardResponseSchema.safeParse({
      counts: {
        pendingRegistrations: 2,
        screeningReviews: 1,
        postedDonations: 3,
        acceptedAwaitingAssignment: 4,
      },
      recentActivity: [
        {
          id: "registration:1",
          type: "REGISTRATION",
          title: "New donor registration",
          detail: "Pending approval",
          occurredAt: "2026-11-25T08:00:00.000Z",
          href: "/admin/registrations",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects negative counts and non-admin hrefs", () => {
    const result = adminDashboardResponseSchema.safeParse({
      counts: {
        pendingRegistrations: -1,
        screeningReviews: 0,
        postedDonations: 0,
        acceptedAwaitingAssignment: 0,
      },
      recentActivity: [
        {
          id: "x",
          type: "REGISTRATION",
          title: "t",
          detail: "d",
          occurredAt: "2026-11-25T08:00:00.000Z",
          href: "/donor",
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
