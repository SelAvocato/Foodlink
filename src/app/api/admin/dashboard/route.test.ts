import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDashboardResponse } from "@/contracts/admin-dashboard";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getAdminDashboard } from "@/server/admin/dashboard";
import { GET } from "./route";

vi.mock("@/server/auth/require-role", () => {
  class AuthorizationError extends Error {
    constructor(
      public readonly code: "UNAUTHENTICATED" | "INACTIVE_ACCOUNT" | "FORBIDDEN",
      message: string,
    ) {
      super(message);
      this.name = "AuthorizationError";
    }
  }
  return { AuthorizationError, requireRole: vi.fn() };
});

vi.mock("@/server/admin/dashboard", () => ({ getAdminDashboard: vi.fn() }));
vi.mock("@/server/admin/prisma-dashboard-store", () => ({ prismaAdminDashboardStore: {} }));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/dashboard${query}`));
}

const dashboard: AdminDashboardResponse = {
  counts: {
    pendingRegistrations: 1,
    screeningReviews: 2,
    postedDonations: 3,
    acceptedAwaitingAssignment: 4,
  },
  recentActivity: [
    {
      id: "registration:1",
      type: "REGISTRATION",
      title: "Donor registration pending",
      detail: "Ana Donor",
      occurredAt: "2026-11-25T08:00:00.000Z",
      href: "/admin/registrations",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(getAdminDashboard).mockResolvedValue(dashboard);
});

describe("GET /api/admin/dashboard", () => {
  it("answers 401 before reading query when unauthenticated", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get("?unknown=1");
    expect(res.status).toBe(401);
    expect(getAdminDashboard).not.toHaveBeenCalled();
  });

  it("answers 403 for forbidden role", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();
    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("rejects unknown query fields", async () => {
    const res = await get("?limit=1");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(getAdminDashboard).not.toHaveBeenCalled();
  });

  it("returns dashboard with no-store", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(dashboard);
    expect(getAdminDashboard).toHaveBeenCalledTimes(1);
  });

  it("logs only safe summary on unexpected errors", async () => {
    vi.mocked(getAdminDashboard).mockRejectedValue(new Error("db secret detail"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await get();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The command center could not be loaded.",
      });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("db secret detail");
      expect(logged).toContain("errorName");
    } finally {
      consoleError.mockRestore();
    }
  });
});
