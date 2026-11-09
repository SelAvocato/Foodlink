import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { getProofSignedUrl } from "@/server/admin/proof-url";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
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
vi.mock("@/server/admin/proof-url", () => ({ getProofSignedUrl: vi.fn() }));
vi.mock("@/server/admin/prisma-proof-store", () => ({ prismaProofStore: {} }));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({})) }));

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const SIGNED_URL = "https://storage.example.test/proofs/signed?token=fake-token";
const STORAGE_KEY = "proofs/33333333-3333-4333-8333-333333333333.jpg";

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function get(id: string, documentId: string): Promise<Response> {
  const request = new Request(
    `http://localhost/api/admin/users/${id}/documents/${documentId}/signed-url`,
  );
  return GET(request, { params: Promise.resolve({ id, documentId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(getProofSignedUrl).mockResolvedValue({
    ok: true,
    url: SIGNED_URL,
    expiresInSeconds: 300,
  });
});

describe("GET /api/admin/users/[id]/documents/[documentId]/signed-url", () => {
  it("answers 401 before validating ids when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(getProofSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 403 when the signed-in user is not an Admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(getProofSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 403 when the account is not active", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("INACTIVE_ACCOUNT", "Your account is not active."),
    );

    const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "INACTIVE_ACCOUNT",
      message: "Your account is not active.",
    });
    expect(getProofSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 400 for a user id that is not a uuid", async () => {
    const res = await get("not-a-uuid", VALID_DOCUMENT_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The user id is invalid.",
    });
    expect(getProofSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 400 for a document id that is not a uuid", async () => {
    const res = await get(VALID_USER_ID, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The document id is invalid.",
    });
    expect(getProofSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 404 when the document is unknown or belongs to another user", async () => {
    vi.mocked(getProofSignedUrl).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The document was not found.",
    });
    expect(getProofSignedUrl).toHaveBeenCalledTimes(1);
  });

  it("returns the URL without caching and sends the session actor as adminId", async () => {
    const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ url: SIGNED_URL, expiresInSeconds: 300 });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(getProofSignedUrl).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(getProofSignedUrl).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.storage).toBeDefined();
    expect(input).toEqual({
      adminId: "admin-1",
      userId: VALID_USER_ID,
      documentId: VALID_DOCUMENT_ID,
    });
  });

  it("answers 500 with a generic message and logs only ids and the error name when signing fails", async () => {
    // A storage or Prisma error can carry the key and the signed URL in its message.
    const message = `sign failed for ${STORAGE_KEY} at ${SIGNED_URL}`;
    vi.mocked(getProofSignedUrl).mockRejectedValue(new Error(message));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The proof URL could not be created.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Proof URL failed");
      expect(Object.keys(details as object).sort()).toEqual(["documentId", "errorName", "userId"]);
      expect(details).toEqual({
        userId: VALID_USER_ID,
        documentId: VALID_DOCUMENT_ID,
        errorName: "Error",
      });

      const serialized = JSON.stringify(consoleError.mock.calls);
      expect(serialized).not.toContain(STORAGE_KEY);
      expect(serialized).not.toContain(SIGNED_URL);
      expect(serialized).not.toContain(message);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("logs a code when the failing error has one, never the message", async () => {
    const message = `sign failed for ${STORAGE_KEY} at ${SIGNED_URL}`;
    vi.mocked(getProofSignedUrl).mockRejectedValue(
      Object.assign(new Error(message), { code: "P2025" }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get(VALID_USER_ID, VALID_DOCUMENT_ID);

      expect(res.status).toBe(500);
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [, details] = consoleError.mock.calls[0];
      expect(Object.keys(details as object).sort()).toEqual([
        "documentId",
        "errorCode",
        "errorName",
        "userId",
      ]);
      expect(details).toEqual({
        userId: VALID_USER_ID,
        documentId: VALID_DOCUMENT_ID,
        errorName: "Error",
        errorCode: "P2025",
      });

      const serialized = JSON.stringify(consoleError.mock.calls);
      expect(serialized).not.toContain(STORAGE_KEY);
      expect(serialized).not.toContain(SIGNED_URL);
      expect(serialized).not.toContain(message);
    } finally {
      consoleError.mockRestore();
    }
  });
});
