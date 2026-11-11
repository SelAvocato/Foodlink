import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getChecklist, saveChecklist, type ChecklistView } from "@/server/checklist/donation-checklist";
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
vi.mock("@/server/checklist/donation-checklist", () => ({ saveChecklist: vi.fn(), getChecklist: vi.fn() }));
vi.mock("@/server/checklist/prisma-checklist-store", () => ({ prismaChecklistStore: {} }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

const checklistView: ChecklistView = {
  preparedAt: "2026-11-08T08:00:00.000Z",
  consumeByAt: "2026-11-08T14:00:00.000Z",
  storageCondition: "REFRIGERATED",
  storageTemperatureC: 4,
  packagingIntact: true,
  allergensConfirmed: true,
  notCustomerPlateLeftovers: true,
  completedAt: "2026-11-08T09:00:00.000Z",
  updatedAt: "2026-11-08T09:00:00.000Z",
};

function put(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/checklist`, {
    method: "PUT",
    body,
    headers: { "content-type": "application/json" },
  });
  return PUT(request, { params: Promise.resolve({ id }) });
}

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/checklist`, { method: "GET" });
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
  vi.mocked(saveChecklist).mockResolvedValue({ ok: true, complete: true, missing: [] });
  vi.mocked(getChecklist).mockResolvedValue({
    ok: true,
    checklist: checklistView,
    complete: true,
    missing: [],
  });
});

describe("PUT /api/donor/drafts/[id]/checklist", () => {
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
    expect(saveChecklist).not.toHaveBeenCalled();
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
      expect(saveChecklist).not.toHaveBeenCalled();
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
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await put(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including donorId", async () => {
    const res = await put(VALID_ID, JSON.stringify({ packagingIntact: true, donorId: "someone-else" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("donorId");
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it("answers 400 for a datetime without a UTC offset", async () => {
    const res = await put(VALID_ID, JSON.stringify({ consumeByAt: "2026-11-08T10:00:00" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Object.keys(body.details.fieldErrors)).toContain("consumeByAt");
    expect(saveChecklist).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The draft was not found."],
    ["NOT_EDITABLE", 409, "That draft can no longer be edited."],
    ["CONSUME_BY_NOT_AFTER_PREPARED", 422, "The consume-by time must be after the prepared time."],
    ["CONSUME_BY_NOT_AFTER_PICKUP_END", 422, "The consume-by time must be after the pickup window ends."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(saveChecklist).mockResolvedValue({ ok: false, error });

    const res = await put(VALID_ID, JSON.stringify({ packagingIntact: true }));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(saveChecklist).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await put(VALID_ID, JSON.stringify({ packagingIntact: true }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(saveChecklist).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(saveChecklist).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The service store sees the session donor id, so a foreign draft is a NOT_FOUND.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("saves the checklist for the session donor and answers 200", async () => {
    const res = await put(
      VALID_ID,
      JSON.stringify({ consumeByAt: "2026-11-08T14:00:00+08:00", packagingIntact: true }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donationId: VALID_ID, complete: true, missing: [] });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(saveChecklist).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(saveChecklist).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The donor id comes from the session, never from the body.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args.input.consumeByAt).toBeInstanceOf(Date);
    expect(args.input.packagingIntact).toBe(true);
    expect(args.input).not.toHaveProperty("donorId");
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(saveChecklist).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await put(VALID_ID, JSON.stringify({ packagingIntact: true }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The checklist could not be saved.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Checklist save failed");
    expect(details).toMatchObject({ donationId: VALID_ID, errorName: "Error" });
    consoleError.mockRestore();
  });
});

describe("GET /api/donor/drafts/[id]/checklist", () => {
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
    expect(getChecklist).not.toHaveBeenCalled();
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
      expect(getChecklist).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(getChecklist).not.toHaveBeenCalled();
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(getChecklist).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await get(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(getChecklist).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getChecklist).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("returns the checklist for the session donor and answers 200", async () => {
    const res = await get(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checklist: checklistView, complete: true, missing: [] });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(getChecklist).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getChecklist).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(getChecklist).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(VALID_ID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The checklist could not be loaded.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Checklist read failed");
    expect(details).toMatchObject({ donationId: VALID_ID, errorName: "Error" });
    consoleError.mockRestore();
  });
});
