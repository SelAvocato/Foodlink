import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import type { VolunteerDonationListRow } from "@/contracts/volunteer-donation-list";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaVolunteerDonationListStore } from "@/server/volunteer/prisma-volunteer-donation-list-store";
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
vi.mock("@/server/volunteer/prisma-volunteer-donation-list-store", () => ({
  prismaVolunteerDonationListStore: { findPage: vi.fn() },
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

const volunteerActor: AuthenticatedActor = {
  id: "volunteer-1",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function row(overrides: Partial<VolunteerDonationListRow> = {}): VolunteerDonationListRow {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: DonationStatus.ASSIGNED,
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: new Date("2026-11-14T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-14T10:00:00.000Z"),
    donorName: "Test Bakery",
    donorPhone: "+639170000000",
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/volunteer/donations${query}`));
}

function findPage() {
  return vi.mocked(prismaVolunteerDonationListStore.findPage);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  findPage().mockResolvedValue({ rows: [row()], total: 1 });
});

describe("GET /api/volunteer/donations", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get("?page=0");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(findPage()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(findPage()).not.toHaveBeenCalled();
  });

  it("rejects ?volunteerId=abc with 400 and never reaches the store", async () => {
    const res = await get("?volunteerId=abc");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "INVALID_REQUEST",
      message: "The donation list query is invalid.",
    });
    expect(body.details).toBeDefined();
    expect(findPage()).not.toHaveBeenCalled();
  });

  it("passes only the session volunteer id to the store", async () => {
    await get();

    expect(findPage()).toHaveBeenCalledWith({
      volunteerId: volunteerActor.id,
      statuses: [DonationStatus.ASSIGNED, DonationStatus.PICKED_UP, DonationStatus.DELIVERED],
      limit: 20,
      offset: 0,
    });
  });

  it("returns the page with Cache-Control: no-store", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      items: [
        {
          donationId: DONATION_ID,
          shortCode: "ABCDEF12",
          foodName: "Chicken adobo",
          category: "Cooked meals",
          portions: 25,
          status: "ASSIGNED",
          pickupAddress: "12 Mabini St, Quezon City",
          pickupStart: "2026-11-14T08:00:00.000Z",
          pickupEnd: "2026-11-14T10:00:00.000Z",
          donorName: "Test Bakery",
          donorPhone: "+639170000000",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
  });

  it("applies the status filter and paging", async () => {
    await get("?status=PICKED_UP&page=2&pageSize=5");

    expect(findPage()).toHaveBeenCalledWith({
      volunteerId: volunteerActor.id,
      statuses: [DonationStatus.PICKED_UP],
      limit: 5,
      offset: 5,
    });
  });

  it("returns only the allow-listed fields", async () => {
    findPage().mockResolvedValue({
      rows: [
        Object.assign(row(), {
          volunteerId: volunteerActor.id,
          donorId: "donor-id",
          donorEmail: "donor@example.com",
          addressId: "address-id",
          qrToken: "qr-token-value",
          storageKey: "food-photos/secret.jpg",
        }),
      ],
      total: 1,
    });

    const res = await get();
    const body = await res.json();

    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        "category",
        "donationId",
        "donorName",
        "donorPhone",
        "foodName",
        "pickupAddress",
        "pickupEnd",
        "pickupStart",
        "portions",
        "shortCode",
        "status",
      ].sort(),
    );
    const serialized = JSON.stringify(body);
    for (const leaked of [
      volunteerActor.id,
      "donor-id",
      "donor@example.com",
      "address-id",
      "qr-token-value",
      "secret.jpg",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it("answers 500 with a generic body and a log without donor details", async () => {
    findPage().mockRejectedValue(
      new Error(
        "query failed for Maria Santos +639170000000 12 Mabini St qr-token-value food-photos/secret.jpg",
      ),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: "INTERNAL_ERROR",
        message: "The donations could not be loaded.",
      });
      expect(body).not.toHaveProperty("items");
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Volunteer donation list failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      for (const secret of [
        "Maria Santos",
        "+639170000000",
        "12 Mabini St",
        "qr-token-value",
        "secret.jpg",
        "query failed for",
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
