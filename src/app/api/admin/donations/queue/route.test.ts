import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDonationQueueItem } from "@/contracts/admin-donation-queue";
import type { AuthenticatedActor } from "@/contracts/authz";
import { prismaDonationQueueStore } from "@/server/admin/prisma-donation-queue-store";
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
vi.mock("@/server/admin/prisma-donation-queue-store", () => ({
  prismaDonationQueueStore: { findPostedDonations: vi.fn() },
}));

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function item(overrides: Partial<AdminDonationQueueItem> = {}): AdminDonationQueueItem {
  return {
    donationId: "11111111-1111-4111-8111-111111111111",
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    donorName: "Test Bakery",
    donorType: "ESTABLISHMENT",
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: new Date("2026-11-10T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-10T10:00:00.000Z"),
    postedAt: new Date("2026-11-09T08:00:00.000Z"),
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/donations/queue${query}`));
}

function findPostedDonations() {
  return vi.mocked(prismaDonationQueueStore.findPostedDonations);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  findPostedDonations().mockResolvedValue([]);
});

describe("GET /api/admin/donations/queue", () => {
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
    expect(findPostedDonations()).not.toHaveBeenCalled();
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
    expect(findPostedDonations()).not.toHaveBeenCalled();
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
    expect(findPostedDonations()).not.toHaveBeenCalled();
  });

  it.each(["limit=0", "limit=101", "limit=1.5", "limit=abc", "foodCategoryId=0", "foodCategoryId=-1", "foodCategoryId=1.5", "foodCategoryId=40000", "status=POSTED"])(
    "answers 400 INVALID_REQUEST with details for ?%s",
    async (query) => {
      const res = await get(`?${query}`);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.details).toBeDefined();
      expect(findPostedDonations()).not.toHaveBeenCalled();
    },
  );

  it("returns the queue on success with Cache-Control: no-store", async () => {
    const rows = [item(), item({ donationId: "22222222-2222-4222-8222-222222222222" })];
    findPostedDonations().mockResolvedValue(rows);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      donations: rows.map((row) => ({
        ...row,
        pickupStart: row.pickupStart?.toISOString() ?? null,
        pickupEnd: row.pickupEnd?.toISOString() ?? null,
        postedAt: row.postedAt?.toISOString() ?? null,
      })),
    });
    expect(findPostedDonations()).toHaveBeenCalledTimes(1);
    // No category filter sent: the function receives NULL, and the default limit is 50.
    expect(findPostedDonations()).toHaveBeenCalledWith(null, 50);
  });

  it("returns 200 with an empty array when the queue is empty", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donations: [] });
  });

  it("applies the requested limit and passes foodCategoryId to the store", async () => {
    findPostedDonations().mockResolvedValue([item({ donationId: "a" }), item({ donationId: "b" })]);

    const res = await get("?limit=1&foodCategoryId=3");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.donations).toHaveLength(1);
    expect(findPostedDonations()).toHaveBeenCalledWith(3, 1);
  });

  it("returns only the allow-listed fields, never contact details, QR or storage keys", async () => {
    const leaky = Object.assign(item(), {
      donorEmail: "donor@example.com",
      donorPhone: "+639170000000",
      donorUserId: "donor-user-id",
      addressId: "address-id",
      pickupAddressId: "address-id",
      qrToken: "qr-token-value",
      storageKey: "food-photos/secret.jpg",
    });
    findPostedDonations().mockResolvedValue([leaky]);

    const res = await get();
    const body = await res.json();

    expect(Object.keys(body.donations[0]).sort()).toEqual([
      "category",
      "donationId",
      "donorName",
      "donorType",
      "foodName",
      "pickupAddress",
      "pickupEnd",
      "pickupStart",
      "portions",
      "postedAt",
    ]);
    const serialized = JSON.stringify(body);
    for (const leaked of ["donor@example.com", "+639170000000", "donor-user-id", "address-id", "qr-token-value", "secret.jpg", "email", "phone", "qr", "token", "storage"]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("answers 500 with a generic message and logs only a safe summary", async () => {
    findPostedDonations().mockRejectedValue(new Error("relation fn_admin_donation_queue does not exist"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The donation queue could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("does not exist");
      expect(logged).toContain("errorName");
    } finally {
      consoleError.mockRestore();
    }
  });
});
