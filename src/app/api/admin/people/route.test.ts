import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminPeopleListResponse } from "@/contracts/admin-people";
import type { AuthenticatedActor } from "@/contracts/authz";
import { listAdminPeople } from "@/server/admin/people";
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
vi.mock("@/server/admin/people", () => ({ listAdminPeople: vi.fn() }));
vi.mock("@/server/admin/prisma-people-store", () => ({ prismaAdminPeopleStore: {} }));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

const emptyResult: AdminPeopleListResponse = {
  people: [],
  counts: { DONOR: 4, VOLUNTEER: 2 },
  page: 1,
  pageSize: 20,
  total: 0,
};

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/people${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(listAdminPeople).mockResolvedValue(emptyResult);
});

describe("GET /api/admin/people", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get("?role=NOBODY");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(listAdminPeople).not.toHaveBeenCalled();
  });

  it("answers 403 for a non-Admin or inactive account", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const forbidden = await get();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });

    vi.mocked(requireRole).mockRejectedValueOnce(
      new AuthorizationError("INACTIVE_ACCOUNT", "Your account is not active."),
    );
    const inactive = await get();
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toEqual({
      error: "INACTIVE_ACCOUNT",
      message: "Your account is not active.",
    });
    expect(listAdminPeople).not.toHaveBeenCalled();
  });

  it("returns the paginated response with default query values", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual(emptyResult);
    expect(listAdminPeople).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(listAdminPeople).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(input).toEqual({ role: "DONOR", status: "ALL", type: "ALL", q: "", page: 1, pageSize: 20 });
  });

  it("passes through search, filters and pagination", async () => {
    const res = await get(
      "?role=VOLUNTEER&status=SUSPENDED&q=%20rivers%20&page=3&pageSize=10",
    );

    expect(res.status).toBe(200);
    const [, input] = vi.mocked(listAdminPeople).mock.calls[0];
    expect(input).toEqual({
      role: "VOLUNTEER",
      status: "SUSPENDED",
      type: "ALL",
      q: "rivers",
      page: 3,
      pageSize: 10,
    });
  });

  it("rejects invalid filters, unknown keys and page values", async () => {
    for (const query of [
      "?role=ADMIN",
      "?status=PENDING",
      "?type=UNKNOWN",
      "?q=12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901",
      "?page=0",
      "?pageSize=51",
      "?foo=1",
    ]) {
      const res = await get(query);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
    }
    expect(listAdminPeople).not.toHaveBeenCalled();
  });

  it("rejects a donor type filter on the volunteer tab", async () => {
    const res = await get("?role=VOLUNTEER&type=INDIVIDUAL");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.fieldErrors.type.join(" ")).toContain("donor");
    expect(listAdminPeople).not.toHaveBeenCalled();
  });

  it("logs only a safe error summary on failure", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listAdminPeople).mockRejectedValue(new Error("secret query text"));

    const res = await get();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL_ERROR", message: "People could not be loaded." });
    expect(errorLog).toHaveBeenCalledWith("Admin people list failed", { errorName: "Error" });
    errorLog.mockRestore();
  });
});
