import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { DonorDonationListRow } from "@/contracts/donor-donation-list";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaDonationListStore } from "@/server/donor/prisma-donation-list-store";
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
vi.mock("@/server/donor/prisma-donation-list-store", () => ({
  prismaDonationListStore: { findPage: vi.fn(), countByTab: vi.fn() },
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function row(overrides: Partial<DonorDonationListRow> = {}): DonorDonationListRow {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: "POSTED",
    pickupStart: new Date("2026-11-14T08:00:00.000Z"),
    pickupEnd: new Date("2026-11-14T10:00:00.000Z"),
    updatedAt: new Date("2026-11-13T09:00:00.000Z"),
    checklistComplete: true,
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/donor/donations${query}`));
}

function findPage() {
  return vi.mocked(prismaDonationListStore.findPage);
}

function countByTab() {
  return vi.mocked(prismaDonationListStore.countByTab);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  findPage().mockResolvedValue({ rows: [row()], total: 1 });
  countByTab().mockResolvedValue({ drafts: 2, active: 3, completed: 4, notCompleted: 5 });
});

describe("GET /api/donor/donations", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    // A bad tab would be a 400 if the query string were read first.
    const res = await get("?tab=nope");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(findPage()).not.toHaveBeenCalled();
    expect(countByTab()).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "VOLUNTEER"] as const)(
    "answers 403 for a signed-in %s",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );

      const res = await get();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(findPage()).not.toHaveBeenCalled();
    },
  );

  it("returns the page for the Donor with Cache-Control: no-store", async () => {
    const res = await get("?tab=active&q=adobo&page=2&pageSize=10");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      tab: "active",
      items: [
        {
          donationId: DONATION_ID,
          shortCode: "ABCDEF12",
          foodName: "Chicken adobo",
          category: "Cooked meals",
          portions: 25,
          status: "POSTED",
          pickupStart: "2026-11-14T08:00:00.000Z",
          pickupEnd: "2026-11-14T10:00:00.000Z",
          updatedAt: "2026-11-13T09:00:00.000Z",
          checklistComplete: true,
        },
      ],
      page: 2,
      pageSize: 10,
      total: 1,
      counts: { drafts: 2, active: 3, completed: 4, notCompleted: 5 },
    });
  });

  it("passes exactly the session actor id to the store", async () => {
    // There is no id in the URL, so the session is the only source of the donor id.
    await get("?tab=active");

    expect(findPage()).toHaveBeenCalledWith({
      donorId: donorActor.id,
      statuses: ["POSTED", "ACCEPTED", "ASSIGNED", "PICKED_UP", "DELIVERED"],
      q: undefined,
      limit: 20,
      offset: 0,
    });
    expect(countByTab()).toHaveBeenCalledWith(donorActor.id);
  });

  it("rejects a donorId in the query string and never reaches the store", async () => {
    const res = await get("?donorId=99999999-9999-4999-8999-999999999999");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: "INVALID_REQUEST",
      message: "The donation list query is invalid.",
    });
    expect(findPage()).not.toHaveBeenCalled();
    expect(countByTab()).not.toHaveBeenCalled();
  });

  it("answers 400 for a bad tab and never reaches the store", async () => {
    const res = await get("?tab=everything");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "INVALID_REQUEST" });
    expect(findPage()).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic body and a log without the query or the rows", async () => {
    findPage().mockRejectedValue(new Error("relation donations failed for Maria Santos"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get("?q=adobo");

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({
        error: "INTERNAL_ERROR",
        message: "The donations could not be loaded.",
      });
      expect(body).not.toHaveProperty("items");
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Donor donation list failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      for (const secret of ["Maria Santos", "adobo", DONATION_ID, "donations failed for"]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
