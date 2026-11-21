import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { ActiveVolunteerRow } from "@/server/admin/active-volunteers";
import { prismaActiveVolunteersStore } from "@/server/admin/prisma-active-volunteers-store";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
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
vi.mock("@/server/admin/prisma-active-volunteers-store", () => ({
  prismaActiveVolunteersStore: { findActiveVolunteers: vi.fn() },
}));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function row(overrides: Partial<ActiveVolunteerRow> = {}): ActiveVolunteerRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Test Volunteer",
    availability: "Weekends",
    role: "VOLUNTEER",
    status: "ACTIVE",
    deletedAt: null,
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/volunteers${query}`));
}

function findActiveVolunteers() {
  return vi.mocked(prismaActiveVolunteersStore.findActiveVolunteers);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  findActiveVolunteers().mockResolvedValue([]);
});

describe("GET /api/admin/volunteers", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    // limit=0 would be a 400 if the query were read first.
    const res = await get("?limit=0");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(findActiveVolunteers()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "VOLUNTEER"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(findActiveVolunteers()).not.toHaveBeenCalled();
  });

  it("answers 403 when the account is not active", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("INACTIVE_ACCOUNT", "Your account is not active."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "INACTIVE_ACCOUNT",
      message: "Your account is not active.",
    });
    expect(findActiveVolunteers()).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=101", "limit=1.5", "limit=abc", "search=Ana"])(
    "answers 400 INVALID_REQUEST with details for ?%s",
    async (query) => {
      const res = await get(`?${query}`);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.details).toBeDefined();
      expect(findActiveVolunteers()).not.toHaveBeenCalled();
    },
  );

  it("returns the wrapped volunteer list on success with the default limit", async () => {
    const rows = [
      row({ id: "volunteer-a", fullName: "Ana Reyes" }),
      row({ id: "volunteer-b", fullName: "Carlo Dela Cruz", availability: null }),
    ];
    findActiveVolunteers().mockResolvedValue(rows);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      volunteers: [
        { volunteerId: "volunteer-a", fullName: "Ana Reyes", availability: "Weekends" },
        { volunteerId: "volunteer-b", fullName: "Carlo Dela Cruz", availability: null },
      ],
    });
    expect(findActiveVolunteers()).toHaveBeenCalledTimes(1);
    expect(findActiveVolunteers()).toHaveBeenCalledWith(100);
  });

  it("passes the parsed limit to the store", async () => {
    const res = await get("?limit=10");

    expect(res.status).toBe(200);
    expect(findActiveVolunteers()).toHaveBeenCalledWith(10);
  });

  it("returns only the three fields, so a leaky store row cannot expose anything else", async () => {
    const leaky = Object.assign(row({ id: "leaky-1" }), {
      email: "volunteer@example.com",
      contactNumber: "+639170000000",
      address: "12 Mabini St, Quezon City",
      passwordHash: "secret-hash",
      documents: [{ storageKey: "proofs/secret-key.jpg" }],
    });
    findActiveVolunteers().mockResolvedValue([leaky]);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.volunteers[0]).sort()).toEqual([
      "availability",
      "fullName",
      "volunteerId",
    ]);
    const serialized = JSON.stringify(body);
    for (const leaked of [
      "volunteer@example.com",
      "+639170000000",
      "Mabini",
      "secret-hash",
      "secret-key",
      "email",
      "contactNumber",
      "password",
      "documents",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("returns 200 with an empty array when no volunteer matches", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ volunteers: [] });
  });

  it("answers 500 with a generic message and logs only a safe summary", async () => {
    findActiveVolunteers().mockRejectedValue(new Error("users table missing"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The active volunteer list could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("table missing");
      expect(logged).toContain("errorName");
    } finally {
      consoleError.mockRestore();
    }
  });
});
