import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getFoodPhotoUrl, saveFoodPhoto } from "@/server/photos/donation-photo";
import { GET, POST } from "./route";

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
vi.mock("@/server/photos/donation-photo", () => ({ saveFoodPhoto: vi.fn(), getFoodPhotoUrl: vi.fn() }));
vi.mock("@/server/photos/prisma-photo-store", () => ({ prismaPhotoStore: {} }));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({})) }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";
const STORAGE_KEY = "food/22222222-2222-4222-8222-222222222222.jpg";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function photoFile(bytes: Uint8Array<ArrayBuffer> = JPEG, type = "image/jpeg"): File {
  return new File([bytes], "photo.jpg", { type });
}

function multipart(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

function post(id: string, body: BodyInit): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/photo`, { method: "POST", body });
  return POST(request, { params: Promise.resolve({ id }) });
}

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/donor/drafts/${id}/photo`, { method: "GET" });
  return GET(request, { params: Promise.resolve({ id }) });
}

/**
 * A params promise that counts how often it is awaited, so a refusal test can
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(saveFoodPhoto).mockResolvedValue({ ok: true, imageId: "image-1" });
  vi.mocked(getFoodPhotoUrl).mockResolvedValue({
    ok: true,
    url: SIGNED_URL,
    expiresInSeconds: 300,
    mimeType: "image/jpeg",
  });
});

describe("POST /api/donor/drafts/[id]/photo", () => {
  it("answers 401 without reading the params or the form body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const formData = vi.fn();
    const { context, reads } = trackedContext(VALID_ID);

    const res = await POST({ formData } as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(formData).not.toHaveBeenCalled();
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the form body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const formData = vi.fn();
      const { context, reads } = trackedContext(VALID_ID);

      const res = await POST({ formData } as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(formData).not.toHaveBeenCalled();
      expect(saveFoodPhoto).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the form body", async () => {
    const formData = vi.fn();

    const res = await POST({ formData } as unknown as Request, { params: Promise.resolve({ id: "not-a-uuid" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(formData).not.toHaveBeenCalled();
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it("answers 400 when the body is not multipart form data", async () => {
    const res = await post(VALID_ID, "not-a-form");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send the photo as multipart form data.",
    });
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it("answers 400 when the photo field is missing", async () => {
    const res = await post(VALID_ID, multipart({ donorId: "someone-else" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_REQUEST");
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it("answers 400 for bytes that are not a JPEG, PNG or WebP, like signup", async () => {
    const res = await post(VALID_ID, multipart({ photo: photoFile(new TextEncoder().encode("not an image")) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Photo must be a JPEG, PNG, or WebP image up to 4 MB.",
    });
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it("answers 400 for a photo over 4 MB, like signup", async () => {
    const res = await post(VALID_ID, multipart({ photo: photoFile(new Uint8Array(MAX_PHOTO_BYTES + 1)) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Photo must be a JPEG, PNG, or WebP image up to 4 MB.",
    });
    expect(saveFoodPhoto).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The draft was not found."],
    ["NOT_EDITABLE", 409, "That draft can no longer be edited."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(saveFoodPhoto).mockResolvedValue({ ok: false, error });

    const res = await post(VALID_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("sends the session donor id and answers 201, ignoring an unknown donorId field", async () => {
    const form = multipart({ photo: photoFile(), donorId: "someone-else" });

    const res = await post(VALID_ID, form);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ donationId: VALID_ID, imageId: "image-1" });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(saveFoodPhoto).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(saveFoodPhoto).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.storage).toBeDefined();
    // The donor id comes from the session, never from the form.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
    expect(args.file.contentType).toBe("image/jpeg");
    expect(args.file.data).toEqual(JPEG);
  });

  it("answers 404 for another donor's draft", async () => {
    vi.mocked(saveFoodPhoto).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The draft was not found.",
    });
    expect(vi.mocked(saveFoodPhoto).mock.calls[0][1].donorId).toBe("donor-1");
  });

  it("answers 500 with a generic message and logs only the id when the upload fails", async () => {
    vi.mocked(saveFoodPhoto).mockRejectedValue(new Error(`storage exploded for ${STORAGE_KEY}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The photo could not be saved.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Photo upload failed");
    expect(Object.keys(details as object).sort()).toEqual(["donationId", "error"]);
    expect((details as { donationId: string }).donationId).toBe(VALID_ID);
    consoleError.mockRestore();
  });
});

describe("GET /api/donor/drafts/[id]/photo", () => {
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
    expect(getFoodPhotoUrl).not.toHaveBeenCalled();
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
      expect(getFoodPhotoUrl).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(getFoodPhotoUrl).not.toHaveBeenCalled();
  });

  it("answers 404 with the photo message for no photo or another donor's draft", async () => {
    vi.mocked(getFoodPhotoUrl).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await get(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The photo was not found.",
    });
    expect(vi.mocked(getFoodPhotoUrl).mock.calls[0][1].donorId).toBe("donor-1");
  });

  it("returns the signed URL without caching and without the key", async () => {
    const res = await get(VALID_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ url: SIGNED_URL, expiresInSeconds: 300, mimeType: "image/jpeg" });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(getFoodPhotoUrl).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(getFoodPhotoUrl).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.storage).toBeDefined();
    expect(args).toEqual({ donorId: "donor-1", donationId: VALID_ID });
  });

  it("answers 500 with a generic message and logs only the id when signing fails", async () => {
    vi.mocked(getFoodPhotoUrl).mockRejectedValue(new Error(`signing failed for ${STORAGE_KEY}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get(VALID_ID);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The photo could not be loaded.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Photo URL failed");
    expect(Object.keys(details as object).sort()).toEqual(["donationId", "error"]);
    consoleError.mockRestore();
  });
});
