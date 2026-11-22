import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { AcceptedDonationRow } from "@/server/admin/accepted-donations";
import { prismaAcceptedDonationsStore } from "@/server/admin/prisma-accepted-donations-store";
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
vi.mock("@/server/admin/prisma-accepted-donations-store", () => ({
  prismaAcceptedDonationsStore: { findAcceptedDonations: vi.fn() },
}));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

// Far-future pickup ends, so the route's real clock always sees them as live.
function row(overrides: Partial<AcceptedDonationRow> = {}): AcceptedDonationRow {
  return {
    donationId: "11111111-1111-4111-8111-111111111111",
    foodName: "Chicken adobo",
    portions: 25,
    donorBusinessName: "Test Bakery",
    donorFullName: "Maria Santos",
    status: "ACCEPTED",
    pickupEnd: new Date("2099-11-10T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/donations/accepted${query}`));
}

function findAcceptedDonations() {
  return vi.mocked(prismaAcceptedDonationsStore.findAcceptedDonations);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  findAcceptedDonations().mockResolvedValue([]);
});

describe("GET /api/admin/donations/accepted", () => {
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
    expect(findAcceptedDonations()).not.toHaveBeenCalled();
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
    expect(findAcceptedDonations()).not.toHaveBeenCalled();
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
    expect(findAcceptedDonations()).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=101", "limit=1.5", "limit=abc", "status=ACCEPTED"])(
    "answers 400 INVALID_REQUEST with details for ?%s",
    async (query) => {
      const res = await get(`?${query}`);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.details).toBeDefined();
      expect(findAcceptedDonations()).not.toHaveBeenCalled();
    },
  );

  it("returns the wrapped donation list on success with the default limit and no-store", async () => {
    const rows = [
      row({ donationId: "d1", foodName: "Fresh produce" }),
      row({
        donationId: "d2",
        foodName: "Bread and pastries",
        donorBusinessName: null,
        donorFullName: "Maria Lopez",
        pickupEnd: new Date("2099-11-10T14:00:00.000Z"),
      }),
    ];
    findAcceptedDonations().mockResolvedValue(rows);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      donations: [
        {
          donationId: "d1",
          foodName: "Fresh produce",
          portions: 25,
          donorName: "Test Bakery",
          pickupEnd: "2099-11-10T10:00:00.000Z",
        },
        {
          donationId: "d2",
          foodName: "Bread and pastries",
          portions: 25,
          donorName: "Maria Lopez",
          pickupEnd: "2099-11-10T14:00:00.000Z",
        },
      ],
    });
    expect(findAcceptedDonations()).toHaveBeenCalledTimes(1);
    // The service receives the clock from the route; the default limit is 50.
    const [now, limit] = findAcceptedDonations().mock.calls[0];
    expect(now).toBeInstanceOf(Date);
    expect(limit).toBe(50);
  });

  it("passes the parsed limit to the store", async () => {
    const res = await get("?limit=10");

    expect(res.status).toBe(200);
    const [, limit] = findAcceptedDonations().mock.calls[0];
    expect(limit).toBe(10);
  });

  it("returns only the five fields, so a leaky store row cannot expose anything else", async () => {
    const leaky = Object.assign(row({ donationId: "leaky-1" }), {
      donorEmail: "donor@example.com",
      donorPhone: "+639170000000",
      donorUserId: "donor-user-id",
      pickupAddress: "12 Mabini St, Quezon City",
      qrToken: "qr-token-value",
      storageKey: "food-photos/secret.jpg",
    });
    findAcceptedDonations().mockResolvedValue([leaky]);

    const res = await get();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.donations[0]).sort()).toEqual([
      "donationId",
      "donorName",
      "foodName",
      "pickupEnd",
      "portions",
    ]);
    const serialized = JSON.stringify(body);
    for (const leaked of [
      "donor@example.com",
      "+639170000000",
      "donor-user-id",
      "Mabini",
      "qr-token-value",
      "secret.jpg",
      "email",
      "phone",
      "address",
      "qr",
      "token",
      "storage",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("returns 200 with an empty array when nothing is waiting", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donations: [] });
  });

  it("answers 500 with a generic message and logs only a safe summary", async () => {
    findAcceptedDonations().mockRejectedValue(new Error("donations table missing"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The accepted donation list could not be loaded.",
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
