import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { discardDraft, updateDraft } from "@/server/drafts/donation-drafts";
import { DELETE, PATCH } from "./route";

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
vi.mock("@/server/drafts/donation-drafts", () => ({ updateDraft: vi.fn(), discardDraft: vi.fn() }));
vi.mock("@/server/drafts/prisma-draft-store", () => ({ prismaDraftStore: {} }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function patch(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}`, {
    method: "PATCH",
    body,
    headers: { "content-type": "application/json" },
  });
  return PATCH(request, { params: Promise.resolve({ id }) });
}

function discard(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}`, { method: "DELETE" });
  return DELETE(request, { params: Promise.resolve({ id }) });
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
  vi.mocked(updateDraft).mockResolvedValue({ ok: true });
  vi.mocked(discardDraft).mockResolvedValue({ ok: true });
});

describe("PATCH /api/donor/drafts/[id]", () => {
  it("answers 401 without reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const json = vi.fn();
    const { context, reads } = trackedContext(VALID_ID);

    const res = await PATCH({ json } as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(json).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const json = vi.fn();
      const { context, reads } = trackedContext(VALID_ID);

      const res = await PATCH({ json } as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(json).not.toHaveBeenCalled();
      expect(updateDraft).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the body", async () => {
    const json = vi.fn();

    const res = await PATCH({ json } as unknown as Request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(json).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await patch(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including donorId", async () => {
    const res = await patch(VALID_ID, JSON.stringify({ foodName: "Renamed", donorId: "someone-else" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("donorId");
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it("answers 400 for an empty body", async () => {
    const res = await patch(VALID_ID, JSON.stringify({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("at least one field");
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_EDITABLE", 409],
    ["CATEGORY_LOCKED", 409],
    ["UNKNOWN_CATEGORY", 422],
    ["UNKNOWN_ALLERGEN", 422],
    ["UNKNOWN_DIETARY_TAG", 422],
    ["CATEGORY_NOT_ALLOWED", 422],
  ] as const)("answers %s with status %i", async (error, status) => {
    vi.mocked(updateDraft).mockResolvedValue({ ok: false, error });

    const res = await patch(VALID_ID, JSON.stringify({ foodName: "Renamed" }));

    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toBe(error);
    expect(typeof body.message).toBe("string");
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(updateDraft).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await patch(VALID_ID, JSON.stringify({ foodName: "Not mine" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(updateDraft).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(updateDraft).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The service store sees the session donor id, so a foreign draft is a NOT_FOUND.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("updates the draft for the session donor and answers 200", async () => {
    const res = await patch(VALID_ID, JSON.stringify({ foodName: "Renamed", portions: 40 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donationId: VALID_ID });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(updateDraft).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(updateDraft).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args.input).toMatchObject({ foodName: "Renamed", portions: 40 });
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(updateDraft).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await patch(VALID_ID, JSON.stringify({ foodName: "Renamed" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The draft could not be updated.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Draft update failed");
    expect(details).toMatchObject({ donationId: VALID_ID, error: expect.any(Error) });
    consoleError.mockRestore();
  });
});

describe("DELETE /api/donor/drafts/[id]", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(VALID_ID);

    const res = await DELETE({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const { context, reads } = trackedContext(VALID_ID);

      const res = await DELETE({} as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(discardDraft).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await discard("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(discardDraft).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await discard(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(discardDraft).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(discardDraft).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("answers 409 when the draft can no longer be discarded", async () => {
    vi.mocked(discardDraft).mockResolvedValue({ ok: false, error: "NOT_EDITABLE" });

    const res = await discard(VALID_ID);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "NOT_EDITABLE",
      message: "That draft can no longer be edited.",
    });
  });

  it("discards the draft for the session donor and answers 200", async () => {
    const res = await discard(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donationId: VALID_ID });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(discardDraft).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(discardDraft).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(discardDraft).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await discard(VALID_ID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The draft could not be discarded.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Draft discard failed");
    expect(details).toMatchObject({ donationId: VALID_ID, error: expect.any(Error) });
    consoleError.mockRestore();
  });
});
