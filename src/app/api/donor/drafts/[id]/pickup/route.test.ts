import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getPickup, savePickup, type PickupView } from "@/server/pickup/donation-pickup";
import { GET, PUT } from "./route";

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
vi.mock("@/server/pickup/donation-pickup", () => ({ savePickup: vi.fn(), getPickup: vi.fn() }));
vi.mock("@/server/pickup/prisma-pickup-store", () => ({ prismaPickupStore: {} }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

const validBody = {
  address: { streetLine1: "123 Katipunan Ave", city: "Quezon City" },
  pickupStart: "2026-11-10T09:00:00Z",
  pickupEnd: "2026-11-10T11:00:00Z",
};

const pickupView: PickupView = {
  address: {
    streetLine1: "123 Katipunan Ave",
    streetLine2: null,
    barangay: "Loyola Heights",
    city: "Quezon City",
    provinceOrState: null,
    postalCode: null,
    countryCode: "PH",
    latitude: 14.676,
    longitude: 121.0437,
  },
  pickupStart: "2026-11-10T09:00:00.000Z",
  pickupEnd: "2026-11-10T11:00:00.000Z",
};

function put(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/pickup`, {
    method: "PUT",
    body,
    headers: { "content-type": "application/json" },
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/pickup`, { method: "GET" });
  return GET(request, { params: Promise.resolve({ id }) });
}

/**
 * A params promise that counts how often it is awaited, so a 403 test can prove
 * requireRole() ran before the URL was read.
 */
function trackedContext(id: string): { context: { params: Promise<{ id: string }> }; reads: () => number } {
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
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(savePickup).mockResolvedValue({ ok: true });
  vi.mocked(getPickup).mockResolvedValue({ ok: true, pickup: pickupView });
});

describe("PUT /api/donor/drafts/[id]/pickup", () => {
  it("answers 401 without reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const json = vi.fn();
    const { context, reads } = trackedContext(VALID_ID);

    const res = await PUT({ json } as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(json).not.toHaveBeenCalled();
    expect(savePickup).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const json = vi.fn();
      const { context, reads } = trackedContext(VALID_ID);

      const res = await PUT({ json } as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(json).not.toHaveBeenCalled();
      expect(savePickup).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the body", async () => {
    const json = vi.fn();

    const res = await PUT({ json } as unknown as Request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(json).not.toHaveBeenCalled();
    expect(savePickup).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await put(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(savePickup).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including donorId", async () => {
    const res = await put(VALID_ID, JSON.stringify({ ...validBody, donorId: "someone-else" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("donorId");
    expect(savePickup).not.toHaveBeenCalled();
  });

  it("answers 400 for a datetime without a UTC offset", async () => {
    const res = await put(VALID_ID, JSON.stringify({ ...validBody, pickupStart: "2026-11-10T09:00:00" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Object.keys(body.details.fieldErrors)).toContain("pickupStart");
    expect(savePickup).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The draft was not found."],
    ["NOT_EDITABLE", 409, "That draft can no longer be edited."],
    ["PICKUP_START_NOT_IN_FUTURE", 422, "The pickup window must start in the future."],
    ["CONSUME_BY_NOT_AFTER_PICKUP_END", 422, "The pickup window must end before the consume-by time."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(savePickup).mockResolvedValue({ ok: false, error });

    const res = await put(VALID_ID, JSON.stringify(validBody));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(savePickup).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await put(VALID_ID, JSON.stringify(validBody));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(savePickup).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(savePickup).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The service store sees the session donor id, so a foreign draft is a NOT_FOUND.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("saves the pickup for the session donor and answers 200", async () => {
    const res = await put(VALID_ID, JSON.stringify(validBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donationId: VALID_ID });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(savePickup).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(savePickup).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The donor id comes from the session, never from the body.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args.input.pickupStart).toBeInstanceOf(Date);
    expect(args.input.pickupEnd).toBeInstanceOf(Date);
    expect(args.input.address.streetLine1).toBe("123 Katipunan Ave");
    expect(args.input).not.toHaveProperty("donorId");
    expect(args.input).not.toHaveProperty("donationId");
  });

  it("answers 500 with a generic message and logs no body, address or error message", async () => {
    vi.mocked(savePickup).mockRejectedValue(
      new Error("123 Secret Lane is unreachable; database is down"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await put(VALID_ID, JSON.stringify(validBody));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The pickup could not be saved.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Pickup save failed");
    // The log-safe summary carries only the error name, never the message.
    expect(details).toEqual({ donationId: VALID_ID, error: { errorName: "Error" } });
    const logged = JSON.stringify(details);
    expect(logged).not.toContain("123 Secret Lane");
    expect(logged).not.toContain("database is down");
    expect(logged).not.toContain("123 Katipunan Ave");
    expect(logged).not.toContain("Quezon City");
    consoleError.mockRestore();
  });
});

describe("GET /api/donor/drafts/[id]/pickup", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(VALID_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(getPickup).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const { context, reads } = trackedContext(VALID_ID);

      const res = await GET({} as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(getPickup).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(getPickup).not.toHaveBeenCalled();
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(getPickup).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await get(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(getPickup).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getPickup).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("returns the pickup for the session donor and answers 200", async () => {
    const res = await get(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickup: pickupView });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(getPickup).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getPickup).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("returns a null pickup when no pickup is set", async () => {
    vi.mocked(getPickup).mockResolvedValue({ ok: true, pickup: null });

    const res = await get(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pickup: null });
  });

  it("answers 500 with a generic message and logs no address or error message", async () => {
    vi.mocked(getPickup).mockRejectedValue(new Error("123 Secret Lane is unreachable"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(VALID_ID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The pickup could not be loaded.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Pickup read failed");
    expect(details).toEqual({ donationId: VALID_ID, error: { errorName: "Error" } });
    const logged = JSON.stringify(details);
    expect(logged).not.toContain("123 Secret Lane");
    expect(logged).not.toContain("123 Katipunan Ave");
    consoleError.mockRestore();
  });
});
