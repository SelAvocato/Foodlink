import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { listPendingUsers, type PendingUser } from "@/server/admin/pending-users";
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
vi.mock("@/server/admin/pending-users", () => ({ listPendingUsers: vi.fn() }));
vi.mock("@/server/admin/prisma-pending-users-store", () => ({ prismaPendingUsersStore: {} }));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function pendingUser(id: string): PendingUser {
  return {
    id,
    role: "DONOR",
    fullName: "Test Donor",
    email: `${id}@example.com`,
    createdAt: new Date("2026-11-02T00:00:00.000Z"),
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery Corp",
    documents: [],
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/users${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(listPendingUsers).mockResolvedValue([]);
});

describe("GET /api/admin/users", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get("?status=APPROVED&limit=0");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(listPendingUsers).not.toHaveBeenCalled();
  });

  it("answers 403 when the signed-in user is not an Admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(listPendingUsers).not.toHaveBeenCalled();
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
    expect(listPendingUsers).not.toHaveBeenCalled();
  });

  it("answers 400 when status is not PENDING", async () => {
    const res = await get("?status=APPROVED");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(body.details.fieldErrors.status)).toBe(true);
    expect(body.details.fieldErrors.status.length).toBeGreaterThan(0);
    expect(listPendingUsers).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown query parameters", async () => {
    const res = await get("?foo=1");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("foo");
    expect(listPendingUsers).not.toHaveBeenCalled();
  });

  it("returns the wrapped user list on success with the default limit", async () => {
    const users = [pendingUser("user-a"), pendingUser("user-b")];
    vi.mocked(listPendingUsers).mockResolvedValue(users);

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      users: users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString() })),
    });
    expect(listPendingUsers).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(listPendingUsers).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(input).toEqual({ limit: 50 });
  });

  it("passes the parsed limit to the service", async () => {
    const res = await get("?limit=10");

    expect(res.status).toBe(200);
    const [, input] = vi.mocked(listPendingUsers).mock.calls[0];
    expect(input).toEqual({ limit: 10 });
  });
});
