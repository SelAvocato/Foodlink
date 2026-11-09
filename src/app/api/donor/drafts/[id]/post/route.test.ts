import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { postDonation } from "@/server/posting/post-donation";
import { createPostTransition } from "@/server/posting/post-transition";
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
vi.mock("@/server/posting/post-donation", () => ({ postDonation: vi.fn() }));
vi.mock("@/server/posting/prisma-posting-store", () => ({ prismaPostingStore: {} }));
vi.mock("@/server/posting/post-transition", () => ({
  createPostTransition: vi.fn(() => ({})),
}));

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const EXPIRES_AT = "2026-11-10T11:00:00.000Z";
const QR_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

const confirmedBody = JSON.stringify({ confirmed: true });

function post(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/post`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
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
  vi.mocked(postDonation).mockResolvedValue({
    ok: true,
    donationId: VALID_ID,
    expiresAt: EXPIRES_AT,
  });
});

describe("POST /api/donor/drafts/[id]/post", () => {
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
    expect(postDonation).not.toHaveBeenCalled();
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
      expect(postDonation).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the body", async () => {
    const { request, bodyReaders } = bodyGuard();

    const res = await POST(request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(bodyReaders.every((reader) => reader.mock.calls.length === 0)).toBe(true);
    expect(postDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await post(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(postDonation).not.toHaveBeenCalled();
  });

  it("answers 400 when the confirmation is missing or not true", async () => {
    for (const body of ["{}", JSON.stringify({ confirmed: false }), JSON.stringify({ confirmed: "true" })]) {
      const res = await post(VALID_ID, body);

      expect(res.status).toBe(400);
      const parsed = await res.json();
      expect(parsed.error).toBe("INVALID_REQUEST");
      expect(parsed.message).toBe("The post request is invalid.");
    }
    expect(postDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including a client-supplied qrToken", async () => {
    const res = await post(
      VALID_ID,
      JSON.stringify({ confirmed: true, qrToken: QR_TOKEN, donorId: "someone-else" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    const formErrors = body.details.formErrors.join(" ");
    expect(formErrors).toContain("qrToken");
    expect(formErrors).toContain("donorId");
    expect(postDonation).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The draft was not found."],
    ["NOT_SCREENED", 409, "Photo screening must pass before posting."],
    ["NOT_EDITABLE", 409, "That donation can no longer be posted."],
    ["PHOTO_REQUIRED", 409, "Upload a photo before posting."],
    ["PICKUP_REQUIRED", 422, "Set the pickup address and window before posting."],
    ["PICKUP_START_NOT_IN_FUTURE", 422, "The pickup window must start in the future."],
    ["CONSUME_BY_NOT_AFTER_PICKUP_END", 422, "The pickup window must end before the consume-by time."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(postDonation).mockResolvedValue({ ok: false, error });

    const res = await post(VALID_ID, confirmedBody);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers CHECKLIST_INCOMPLETE with the missing list as details", async () => {
    vi.mocked(postDonation).mockResolvedValue({
      ok: false,
      error: "CHECKLIST_INCOMPLETE",
      missing: ["consumeByAt", "packagingIntact"],
    });

    const res = await post(VALID_ID, confirmedBody);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "CHECKLIST_INCOMPLETE",
      message: "Complete the safety checklist before posting.",
      details: { missing: ["consumeByAt", "packagingIntact"] },
    });
  });

  it("answers 404 when the draft belongs to another donor", async () => {
    vi.mocked(postDonation).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID, confirmedBody);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(postDonation).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(postDonation).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The service store sees the session donor id, so a foreign draft is a NOT_FOUND.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("posts the donation for the session donor and answers 200 without a token", async () => {
    const res = await post(VALID_ID, confirmedBody);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ donationId: VALID_ID, status: "POSTED", expiresAt: EXPIRES_AT });
    expect(body).not.toHaveProperty("qrToken");
    // No 43-character base64url run can be a QR token in this response.
    expect(JSON.stringify(body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(createPostTransition).toHaveBeenCalledTimes(1);
    expect(postDonation).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(postDonation).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.transition).toBeDefined();
    // The donor id comes from the session, never from the body.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args).not.toHaveProperty("qrToken");
  });

  it("answers 500 with a generic message and logs no token", async () => {
    vi.mocked(postDonation).mockRejectedValue(
      new Error(`unique violation on qr_token ${QR_TOKEN}`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID_ID, confirmedBody);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "INTERNAL_ERROR", message: "The donation could not be posted." });
    expect(JSON.stringify(body)).not.toContain(QR_TOKEN);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Posting failed");
    // The log-safe summary carries only the donation id and the error name.
    expect(details).toEqual({ donationId: VALID_ID, errorName: "Error" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain(QR_TOKEN);
    expect(logged).not.toContain("unique violation");
    consoleError.mockRestore();
  });
});
