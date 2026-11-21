import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  store: {
    findTask: vi.fn(),
  },
}));

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
vi.mock("@/server/volunteer/prisma-volunteer-donation-detail-store", () => ({
  prismaVolunteerDonationDetailStore: mocks.store,
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const NOT_FOUND_BODY = {
  error: "NOT_FOUND",
  message: "The task was not found.",
};

// Local constructor times, never fixed Z strings.
const PICKUP_START = new Date(2026, 10, 21, 15, 0);
const PICKUP_END = new Date(2026, 10, 21, 18, 0);

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function taskRow() {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: DonationStatus.ASSIGNED,
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: PICKUP_START,
    pickupEnd: PICKUP_END,
    donorName: "Test Bakery",
    donorPhone: "+639170000000",
  };
}

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/volunteer/donations/${id}`, {
    method: "GET",
  });
  return GET(request, { params: Promise.resolve({ id }) });
}

function trackedContext(id: string): {
  context: { params: Promise<{ id: string }> };
  reads: () => number;
} {
  let reads = 0;
  const resolved = Promise.resolve({ id });
  const thenable = {
    then(
      onFulfilled: (value: { id: string }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      reads += 1;
      return resolved.then(onFulfilled, onRejected);
    },
  };
  return { context: { params: thenable as unknown as Promise<{ id: string }> }, reads: () => reads };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  mocks.store.findTask.mockResolvedValue(taskRow());
});

describe("GET /api/volunteer/donations/[id]", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(mocks.store.findTask).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(reads()).toBe(0);
    expect(mocks.store.findTask).not.toHaveBeenCalled();
  });

  it("returns the task with no-store", async () => {
    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      donationId: DONATION_ID,
      shortCode: "ABCDEF12",
      foodName: "Chicken adobo",
      category: "Cooked meals",
      portions: 25,
      status: "ASSIGNED",
      pickupAddress: "12 Mabini St, Quezon City",
      pickupStart: PICKUP_START.toISOString(),
      pickupEnd: PICKUP_END.toISOString(),
      donorName: "Test Bakery",
      donorPhone: "+639170000000",
    });
  });

  it("returns the donor phone for a delivered task", async () => {
    mocks.store.findTask.mockResolvedValue({
      ...taskRow(),
      status: DonationStatus.DELIVERED,
    });

    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect((await res.json()).donorPhone).toBe("+639170000000");
  });

  it("answers 404 for an id that is not a uuid, without a store read", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
    expect(mocks.store.findTask).not.toHaveBeenCalled();
  });

  it("answers 404 when the store finds no task", async () => {
    mocks.store.findTask.mockResolvedValue(null);

    const res = await get(DONATION_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });

  it("answers 500 with a generic body and a log without sensitive data", async () => {
    mocks.store.findTask.mockRejectedValue(
      new Error("query failed for Test Donor donor@example.com and the QR token"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get(DONATION_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The task could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Volunteer task detail read failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("Test Donor");
      expect(logged).not.toContain("donor@example.com");
      expect(logged).not.toContain("query failed for");
      expect(logged).not.toContain("QR token");
    } finally {
      consoleError.mockRestore();
    }
  });
});
