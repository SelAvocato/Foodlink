import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { DistributionSummary } from "@/contracts/distribution";
import { DonationStatus } from "@/contracts/enums";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getDistributionEntries: vi.fn(),
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
vi.mock("@/server/distribution/entries", () => ({
  getDistributionEntries: mocks.getDistributionEntries,
}));
vi.mock("@/server/distribution/prisma-distribution-read-store", () => ({
  prismaDistributionReadStore: {},
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const NOT_FOUND_BODY = {
  error: "NOT_FOUND",
  message: "The donation was not found.",
};

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};
const adminActor: AuthenticatedActor = {
  id: ADMIN_ID,
  email: "admin@example.com",
  name: "Test Admin",
  role: "ADMIN",
  status: "ACTIVE",
};

const summary: DistributionSummary = {
  id: DONATION_ID,
  referenceCode: "#ABCDEF12",
  status: DonationStatus.DELIVERED,
  totalQuantity: 20,
  unit: "portions",
  distributedQuantity: 8,
  unusableQuantity: 2,
  remainingQuantity: 10,
  entryCount: 1,
  canAddEntry: true,
  canComplete: false,
};

const entries: DistributionEntryView[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    date: "2026-11-18",
    place: "Barangay hall",
    groupServed: "families",
    peopleServed: 30,
    portionsDistributed: 8,
    portionsUnusable: 2,
    unusableReason: "damaged",
    notes: null,
  },
];

function get(id: string): Promise<Response> {
  const request = new Request(
    `http://localhost/api/donations/${id}/distribution-entries`,
    { method: "GET" },
  );
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
  return {
    context: { params: thenable as unknown as Promise<{ id: string }> },
    reads: () => reads,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  mocks.getDistributionEntries.mockResolvedValue({
    ok: true,
    summary,
    entries,
  });
});

describe("GET /api/donations/[id]/distribution-entries", () => {
  it("answers 401 before reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(mocks.getDistributionEntries).not.toHaveBeenCalled();
  });

  it("answers 403 for a donor", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER", "ADMIN"]);
    expect(reads()).toBe(0);
    expect(mocks.getDistributionEntries).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that is not a uuid without a service read", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
    expect(mocks.getDistributionEntries).not.toHaveBeenCalled();
  });

  it("answers 404 when the service does not find the donation", async () => {
    mocks.getDistributionEntries.mockResolvedValue({
      ok: false,
      error: "NOT_FOUND",
    });

    const res = await get(DONATION_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });

  it("answers 409 when the donation is in the wrong state", async () => {
    mocks.getDistributionEntries.mockResolvedValue({
      ok: false,
      error: "INVALID_STATE",
    });

    const res = await get(DONATION_ID);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INVALID_STATE",
      message: "Distribution entries are only available after delivery.",
    });
  });

  it("returns the summary and entries with no-store", async () => {
    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ summary, entries });
    expect(mocks.getDistributionEntries).toHaveBeenCalledWith(
      { store: {} },
      { actor: volunteerActor, donationId: DONATION_ID },
    );
  });

  it("serves an Admin through the same route", async () => {
    vi.mocked(requireRole).mockResolvedValue(adminActor);
    mocks.getDistributionEntries.mockResolvedValue({
      ok: true,
      summary: { ...summary, canAddEntry: false, canComplete: false },
      entries,
    });

    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER", "ADMIN"]);
    expect((await res.json()).summary.canAddEntry).toBe(false);
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getDistributionEntries.mockRejectedValue(
      new Error("query failed for donor@example.com and the storage key"),
    );

    try {
      const res = await get(DONATION_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The distribution entries could not be loaded.",
      });
      expect(spy).toHaveBeenCalledWith("Distribution entries read failed", {
        donationId: DONATION_ID,
        errorName: "Error",
      });
      const logged = JSON.stringify(spy.mock.calls);
      expect(logged).not.toContain("donor@example.com");
      expect(logged).not.toContain("query failed for");
      expect(logged).not.toContain("storage key");
    } finally {
      spy.mockRestore();
    }
  });
});
