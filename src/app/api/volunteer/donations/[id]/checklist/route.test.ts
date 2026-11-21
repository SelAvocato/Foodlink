import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus, StorageCondition } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  store: {
    readDonation: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    readChecklist: vi.fn(),
    readAllergenNames: vi.fn(),
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
vi.mock("@/server/volunteer/prisma-checklist-read-store", () => ({
  prismaChecklistReadStore: mocks.store,
}));

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "volunteer-1";
const OTHER_VOLUNTEER_ID = "volunteer-2";
const NOT_FOUND_BODY = {
  error: "NOT_FOUND",
  message: "The checklist was not found.",
};

// Local constructor times, never fixed Z strings.
const PREPARED_AT = new Date(2026, 10, 21, 9, 30);
const CONSUME_BY_AT = new Date(2026, 10, 21, 18, 0);

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/volunteer/donations/${id}/checklist`, {
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
  mocks.store.readDonation.mockResolvedValue({
    status: DonationStatus.ASSIGNED,
    deletedAt: null,
  });
  mocks.store.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.store.readChecklist.mockResolvedValue({
    preparedAt: PREPARED_AT,
    consumeByAt: CONSUME_BY_AT,
    storageCondition: StorageCondition.REFRIGERATED,
    storageTemperatureC: 4.5,
    packagingIntact: true,
    allergensConfirmed: true,
    notCustomerPlateLeftovers: true,
  });
  mocks.store.readAllergenNames.mockResolvedValue(["Milk", "Peanuts"]);
});

describe("GET /api/volunteer/donations/[id]/checklist", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
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
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("returns the checklist with no-store", async () => {
    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      preparedAt: PREPARED_AT.toISOString(),
      consumeByAt: CONSUME_BY_AT.toISOString(),
      storageCondition: "REFRIGERATED",
      storageTemperatureC: 4.5,
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: true,
      allergens: ["Milk", "Peanuts"],
    });
  });

  it("answers 200 with nulls when the donation has no checklist row", async () => {
    mocks.store.readChecklist.mockResolvedValue(null);
    mocks.store.readAllergenNames.mockResolvedValue([]);

    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      preparedAt: null,
      consumeByAt: null,
      storageCondition: null,
      storageTemperatureC: null,
      packagingIntact: null,
      allergensConfirmed: null,
      notCustomerPlateLeftovers: null,
      allergens: [],
    });
  });

  it("keeps the declared allergens when the donation has no checklist row", async () => {
    mocks.store.readChecklist.mockResolvedValue(null);
    mocks.store.readAllergenNames.mockResolvedValue(["Milk", "Peanuts"]);

    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      preparedAt: null,
      consumeByAt: null,
      storageCondition: null,
      storageTemperatureC: null,
      packagingIntact: null,
      allergensConfirmed: null,
      notCustomerPlateLeftovers: null,
      allergens: ["Milk", "Peanuts"],
    });
  });

  it("answers 404 for an id that is not a uuid, without a store read", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown donation", () => mocks.store.readDonation.mockResolvedValue(null)],
    [
      "a discarded donation",
      () =>
        mocks.store.readDonation.mockResolvedValue({
          status: DonationStatus.ASSIGNED,
          deletedAt: new Date(2026, 10, 20, 8, 0),
        }),
    ],
    [
      "another volunteer's assignment",
      () => mocks.store.findCurrentVolunteerId.mockResolvedValue(OTHER_VOLUNTEER_ID),
    ],
    ["an ended assignment", () => mocks.store.findCurrentVolunteerId.mockResolvedValue(null)],
    [
      "a PICKED_UP donation",
      () =>
        mocks.store.readDonation.mockResolvedValue({
          status: DonationStatus.PICKED_UP,
          deletedAt: null,
        }),
    ],
  ])("answers 404 for %s", async (_label, arrange) => {
    arrange();

    const res = await get(DONATION_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(NOT_FOUND_BODY);
  });

  it("answers 500 with a generic body and a log without sensitive data", async () => {
    mocks.store.readDonation.mockRejectedValue(
      new Error("query failed for Test Donor donor@example.com and the QR token"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get(DONATION_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The checklist could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Volunteer checklist read failed");
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
