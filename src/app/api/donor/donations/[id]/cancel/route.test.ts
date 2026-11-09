import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { cancelDonation } from "@/server/cancel/cancel-donation";
import { createCancelTransition } from "@/server/cancel/cancel-transition";
import { POST } from "./route";

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
vi.mock("@/server/cancel/cancel-donation", () => ({ cancelDonation: vi.fn() }));
vi.mock("@/server/cancel/prisma-cancel-store", () => ({ prismaCancelStore: {} }));
vi.mock("@/server/cancel/cancel-transition", () => ({
  createCancelTransition: vi.fn(() => ({})),
}));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function post(id: string, body?: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/donations/${id}/cancel`, {
    method: "POST",
    ...(body === undefined ? {} : { body, headers: { "content-type": "application/json" } }),
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

/**
 * A params promise that counts how often it is awaited, so a 401/403 test can
 * prove requireRole() ran before the URL was read.
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

/** A request whose body readers throw on any use: the role check must run first. */
function bodyGuard(): { request: Request; bodyReaders: ReturnType<typeof vi.fn>[] } {
  const bodyReaders = [
    vi.fn(() => {
      throw new Error("json() must not be called");
    }),
    vi.fn(() => {
      throw new Error("formData() must not be called");
    }),
    vi.fn(() => {
      throw new Error("text() must not be called");
    }),
  ];
  const request = {
    json: bodyReaders[0],
    formData: bodyReaders[1],
    text: bodyReaders[2],
  } as unknown as Request;
  return { request, bodyReaders };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(cancelDonation).mockResolvedValue({
    ok: true,
    donationId: VALID_ID,
    status: "CANCELLED",
  });
});

describe("POST /api/donor/donations/[id]/cancel", () => {
  it("answers 401 without reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(VALID_ID);
    const { request, bodyReaders } = bodyGuard();

    const res = await POST(request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(bodyReaders.every((reader) => reader.mock.calls.length === 0)).toBe(true);
    expect(cancelDonation).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const { context, reads } = trackedContext(VALID_ID);
      const { request, bodyReaders } = bodyGuard();

      const res = await POST(request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(bodyReaders.every((reader) => reader.mock.calls.length === 0)).toBe(true);
      expect(cancelDonation).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the body", async () => {
    const { request, bodyReaders } = bodyGuard();

    const res = await POST(request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(bodyReaders.every((reader) => reader.mock.calls.length === 0)).toBe(true);
    expect(cancelDonation).not.toHaveBeenCalled();
  });

  it("cancels without a reason when the body is empty", async () => {
    const res = await post(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ donationId: VALID_ID, status: "CANCELLED" });
    expect(cancelDonation).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(cancelDonation).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.transition).toBeDefined();
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args).not.toHaveProperty("reason");
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await post(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(cancelDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including a client-supplied qrToken", async () => {
    const res = await post(VALID_ID, JSON.stringify({ reason: "ok", qrToken: "leak", donationId: "x" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.message).toBe("The cancel request is invalid.");
    const formErrors = body.details.formErrors.join(" ");
    expect(formErrors).toContain("qrToken");
    expect(formErrors).toContain("donationId");
    expect(cancelDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for a reason over 500 characters", async () => {
    const res = await post(VALID_ID, JSON.stringify({ reason: "x".repeat(501) }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.fieldErrors.reason?.[0]).toBe("Use at most 500 characters");
    expect(cancelDonation).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The donation was not found."],
    ["NOT_CANCELLABLE", 409, "This donation can no longer be cancelled."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(cancelDonation).mockResolvedValue({ ok: false, error });

    const res = await post(VALID_ID);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("passes a trimmed reason with the session donor id", async () => {
    const res = await post(VALID_ID, JSON.stringify({ reason: "  Too many portions  " }));

    expect(res.status).toBe(200);
    expect(cancelDonation).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(cancelDonation).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(createCancelTransition).toHaveBeenCalledTimes(1);
    // The donor id comes from the session, never from the body.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args.reason).toBe("Too many portions");
  });

  it("answers 404 when the donation belongs to another donor", async () => {
    vi.mocked(cancelDonation).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID, JSON.stringify({ reason: "ours is fine" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
    const [, args] = vi.mocked(cancelDonation).mock.calls[0];
    expect(args.donorId).toBe("donor-1");
  });

  it("answers 500 with a generic message and a log-safe summary", async () => {
    vi.mocked(cancelDonation).mockRejectedValue(new Error("connection lost"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID_ID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The donation could not be cancelled.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Cancel failed");
    expect(details).toEqual({ donationId: VALID_ID, errorName: "Error" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("connection lost");
    consoleError.mockRestore();
  });
});
