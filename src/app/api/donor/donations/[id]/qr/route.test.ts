import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getQrLabel } from "@/server/qr/get-qr-label";
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
vi.mock("@/server/qr/get-qr-label", () => ({ getQrLabel: vi.fn() }));
vi.mock("@/server/qr/prisma-qr-store", () => ({ prismaQrStore: {} }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const QR_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/donations/${id}/qr`);
  return GET(request, { params: Promise.resolve({ id }) });
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
function guardedRequest(): Request {
  return {
    json: vi.fn(() => {
      throw new Error("json() must not be called");
    }),
    formData: vi.fn(() => {
      throw new Error("formData() must not be called");
    }),
    text: vi.fn(() => {
      throw new Error("text() must not be called");
    }),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(getQrLabel).mockResolvedValue({
    ok: true,
    donationId: VALID_ID,
    status: "POSTED",
    qrToken: QR_TOKEN,
  });
});

describe("GET /api/donor/donations/[id]/qr", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(VALID_ID);

    const res = await GET(guardedRequest(), context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(getQrLabel).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const { context, reads } = trackedContext(VALID_ID);

      const res = await GET(guardedRequest(), context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(getQrLabel).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(getQrLabel).not.toHaveBeenCalled();
  });

  it("returns the token for the session donor with no-store and no extra fields", async () => {
    const res = await get(VALID_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ donationId: VALID_ID, status: "POSTED", qrToken: QR_TOKEN });
    expect(Object.keys(body).sort()).toEqual(["donationId", "qrToken", "status"]);
    expect(getQrLabel).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getQrLabel).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The donor id comes from the session, so another donor's token is a NOT_FOUND.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it.each([
    ["NOT_FOUND", 404, "The donation was not found."],
    ["NOT_AVAILABLE", 409, "The QR label is no longer available."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(getQrLabel).mockResolvedValue({ ok: false, error });

    const res = await get(VALID_ID);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers 404 when the donation belongs to another donor", async () => {
    vi.mocked(getQrLabel).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await get(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "The donation was not found." });
    const [, args] = vi.mocked(getQrLabel).mock.calls[0];
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("answers 500 with a generic message and logs no token", async () => {
    vi.mocked(getQrLabel).mockRejectedValue(
      new Error(`qr label lookup failed for ${QR_TOKEN}`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(VALID_ID);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR", message: "The QR label could not be read." });
    expect(JSON.stringify(body)).not.toContain(QR_TOKEN);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("QR label read failed");
    expect(details).toEqual({ donationId: VALID_ID, errorName: "Error" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(QR_TOKEN);
    expect(logged).not.toContain("qr label lookup failed");
    consoleError.mockRestore();
  });
});
