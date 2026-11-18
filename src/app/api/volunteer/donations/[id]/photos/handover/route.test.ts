import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import {
  HANDOVER_PHOTO_MESSAGE,
  MAX_HANDOVER_PHOTO_BYTES,
} from "@/contracts/volunteer-handover-photo";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { POST } from "./route";

const mocks = vi.hoisted(() => {
  const tx = {
    getDonationLocked: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    softDeleteActiveHandoverPhoto: vi.fn(),
    insertHandoverPhoto: vi.fn(),
  };
  const store = {
    readDonation: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    transaction: vi.fn(async (work: (adapter: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const storage = { uploadImage: vi.fn(), removeObject: vi.fn() };
  return { tx, store, storage };
});

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
vi.mock("@/server/volunteer/prisma-handover-photo-store", () => ({
  prismaHandoverPhotoStore: mocks.store,
}));
vi.mock("@/server/storage", () => ({ createServerStorage: () => mocks.storage }));

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "volunteer-1";
const NEW_KEY = "handover/22222222-2222-4222-8222-222222222222.jpg";
const UPLOADED_AT = new Date("2026-11-18T09:30:00.000Z");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
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
  const request = new Request(
    `http://localhost/api/volunteer/donations/${id}/photos/handover`,
    { method: "POST", body },
  );
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);

  mocks.store.readDonation.mockResolvedValue({ status: DonationStatus.PICKED_UP, deletedAt: null });
  mocks.store.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.tx.getDonationLocked.mockResolvedValue({
    status: DonationStatus.PICKED_UP,
    deletedAt: null,
  });
  mocks.tx.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.tx.softDeleteActiveHandoverPhoto.mockResolvedValue([]);
  mocks.tx.insertHandoverPhoto.mockResolvedValue({ id: "image-1", createdAt: UPLOADED_AT });

  mocks.storage.uploadImage.mockResolvedValue({ key: NEW_KEY });
  mocks.storage.removeObject.mockResolvedValue(undefined);
});

describe("POST /api/volunteer/donations/[id]/photos/handover", () => {
  it("answers 401 without reading the form body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const formData = vi.fn();

    const res = await POST({ formData } as unknown as Request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(res.status).toBe(401);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid donation id with 400 before the form is read", async () => {
    const formData = vi.fn();

    const res = await POST({ formData } as unknown as Request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("rejects a body that is not multipart form data", async () => {
    const res = await post(DONATION_ID, JSON.stringify({ photo: "nope" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send the photo as multipart form data.",
    });
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("rejects a form without a photo file", async () => {
    const res = await post(DONATION_ID, multipart({ photo: "not-a-file" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: HANDOVER_PHOTO_MESSAGE,
    });
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("rejects a file over the cap before reading its bytes", async () => {
    const res = await post(
      DONATION_ID,
      multipart({ photo: photoFile(new Uint8Array(MAX_HANDOVER_PHOTO_BYTES + 1)) }),
    );

    expect(res.status).toBe(400);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("rejects bytes that are not a supported image", async () => {
    const res = await post(
      DONATION_ID,
      multipart({ photo: photoFile(new Uint8Array([1, 2, 3, 4])) }),
    );

    expect(res.status).toBe(400);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("uploads the proof under the handover folder with the session volunteer", async () => {
    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ uploaded: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.store.readDonation).toHaveBeenCalledWith(DONATION_ID);
    expect(mocks.storage.uploadImage).toHaveBeenCalledWith({
      folder: "handover",
      contentType: "image/jpeg",
      data: JPEG,
    });
    expect(mocks.tx.insertHandoverPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        donationId: DONATION_ID,
        uploadedByUserId: VOLUNTEER_ID,
        storageKey: NEW_KEY,
      }),
    );
  });

  it("maps NOT_FOUND to 404", async () => {
    mocks.store.findCurrentVolunteerId.mockResolvedValue("another-volunteer");

    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
  });

  it("maps a finished donation to 409", async () => {
    mocks.store.readDonation.mockResolvedValue({ status: DonationStatus.CLOSED, deletedAt: null });

    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INVALID_STATE",
      message: "This drop-off can no longer be updated.",
    });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.store.readDonation.mockRejectedValue(new Error(`failed for ${NEW_KEY}`));

    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The photo could not be saved.",
    });
    expect(spy).toHaveBeenCalledWith("Handover photo upload failed", {
      donationId: DONATION_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(NEW_KEY);
    spy.mockRestore();
  });
});
