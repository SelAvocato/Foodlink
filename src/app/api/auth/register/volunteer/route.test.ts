import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerVolunteer } from "@/server/registration/register-volunteer";
import { POST } from "./route";

vi.mock("@/server/registration/register-volunteer", () => ({ registerVolunteer: vi.fn() }));
vi.mock("@/server/registration/prisma-registration-store", () => ({ prismaRegistrationStore: {} }));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({})) }));

const PROOF_MESSAGE = "Proof must be a JPEG, PNG, or WebP image up to 4 MB.";
const proofBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function proofFile(bytes: Uint8Array<ArrayBuffer> = proofBytes): File {
  return new File([bytes], "proof.jpg", { type: "image/jpeg" });
}

const addressJson = JSON.stringify({
  streetLine1: "123 Katipunan Ave",
  city: "Quezon City",
  latitude: 14.676,
  longitude: 121.0437,
});

function volunteerForm(overrides: Record<string, string | File | null> = {}): FormData {
  const fd = new FormData();
  fd.set("fullName", "Test Volunteer Person");
  fd.set("contactNumber", "09171234567");
  fd.set("email", "volunteer@example.com");
  fd.set("address", addressJson);
  fd.set("password", "Abcdef1!");
  fd.set("consent", "true");
  fd.set("proof", proofFile());
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) fd.delete(key);
    else fd.set(key, value);
  }
  return fd;
}

function post(fd: FormData): Promise<Response> {
  return POST(new Request("http://localhost/api/auth/register/volunteer", { method: "POST", body: fd }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(registerVolunteer).mockResolvedValue({ ok: true, userId: "user-test-id" });
});

describe("POST /api/auth/register/volunteer", () => {
  it("rejects a body that is not multipart form data", async () => {
    const res = await POST(
      new Request("http://localhost/api/auth/register/volunteer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "not multipart" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send the registration as multipart form data.",
    });
    expect(registerVolunteer).not.toHaveBeenCalled();
  });

  it("rejects a missing proof or a missing address without calling the service", async () => {
    const noProof = await post(volunteerForm({ proof: null }));
    expect(noProof.status).toBe(400);
    expect(await noProof.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send an address JSON value and a proof image.",
    });

    const noAddress = await post(volunteerForm({ address: null }));
    expect(noAddress.status).toBe(400);
    expect(await noAddress.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send an address JSON value and a proof image.",
    });

    expect(registerVolunteer).not.toHaveBeenCalled();
  });

  it("rejects an empty proof or a proof over 4 MB with the exact proof message", async () => {
    const empty = await post(volunteerForm({ proof: proofFile(new Uint8Array(0)) }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "INVALID_REQUEST", message: PROOF_MESSAGE });

    const oversized = await post(volunteerForm({ proof: proofFile(new Uint8Array(4 * 1024 * 1024 + 1)) }));
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toEqual({ error: "INVALID_REQUEST", message: PROOF_MESSAGE });

    expect(registerVolunteer).not.toHaveBeenCalled();
  });

  it("rejects an address that is not valid JSON without calling the service", async () => {
    const res = await post(volunteerForm({ address: "not-json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST", message: "Address must be valid JSON." });
    expect(registerVolunteer).not.toHaveBeenCalled();
  });

  it("returns field errors for a schema failure such as a missing consent", async () => {
    const res = await post(volunteerForm({ consent: "false" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.message).toBe("Some registration fields are invalid.");
    expect(Array.isArray(body.details.fieldErrors.consent)).toBe(true);
    expect(body.details.fieldErrors.consent.length).toBeGreaterThan(0);
    expect(registerVolunteer).not.toHaveBeenCalled();
  });

  it("answers 409 when the service reports EMAIL_TAKEN", async () => {
    vi.mocked(registerVolunteer).mockResolvedValue({ ok: false, error: "EMAIL_TAKEN" });
    const res = await post(volunteerForm());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "EMAIL_TAKEN", message: "Email is already registered." });
  });

  it("answers 400 with the proof message when the service reports INVALID_PROOF", async () => {
    vi.mocked(registerVolunteer).mockResolvedValue({ ok: false, error: "INVALID_PROOF" });
    const res = await post(volunteerForm());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST", message: PROOF_MESSAGE });
  });

  it("answers 201 on success and passes the parsed data plus proof bytes to the service", async () => {
    const res = await post(volunteerForm());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      userId: "user-test-id",
      status: "PENDING",
      message: "Registration submitted for review.",
    });

    expect(registerVolunteer).toHaveBeenCalledTimes(1);
    const [deps, data, bytes] = vi.mocked(registerVolunteer).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.storage).toBeDefined();
    expect(data).toMatchObject({
      fullName: "Test Volunteer Person",
      email: "volunteer@example.com",
      consent: true,
      address: expect.objectContaining({ city: "Quezon City", latitude: 14.676, longitude: 121.0437 }),
    });
    expect(bytes).toEqual(new Uint8Array(proofBytes));
  });

  it("never reads role or status from the body", async () => {
    const res = await post(volunteerForm({ role: "ADMIN", status: "ACTIVE" }));
    expect(res.status).toBe(201);

    const [, data] = vi.mocked(registerVolunteer).mock.calls[0];
    expect(data).not.toHaveProperty("role");
    expect(data).not.toHaveProperty("status");
  });

  it("succeeds without availability and passes no availability to the service", async () => {
    const res = await post(volunteerForm());
    expect(res.status).toBe(201);

    const [, data] = vi.mocked(registerVolunteer).mock.calls[0];
    expect(data.availability).toBeUndefined();
  });

  it("passes a non-empty availability through to the service", async () => {
    const res = await post(volunteerForm({ availability: "Weekend mornings" }));
    expect(res.status).toBe(201);

    const [, data] = vi.mocked(registerVolunteer).mock.calls[0];
    expect(data.availability).toBe("Weekend mornings");
  });

  it("accepts a proof of exactly 4 MB", async () => {
    const res = await post(volunteerForm({ proof: proofFile(new Uint8Array(4 * 1024 * 1024)) }));
    expect(res.status).toBe(201);
    expect(registerVolunteer).toHaveBeenCalledTimes(1);
  });

  it("rejects a latitude without a longitude", async () => {
    const addressWithoutLongitude = JSON.stringify({
      streetLine1: "123 Katipunan Ave",
      city: "Quezon City",
      latitude: 14.676,
    });
    const res = await post(volunteerForm({ address: addressWithoutLongitude }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    // flattenError groups by the first path segment, so the refine lands under "address".
    expect(Array.isArray(body.details.fieldErrors.address)).toBe(true);
    expect(body.details.fieldErrors.address.length).toBeGreaterThan(0);
    expect(registerVolunteer).not.toHaveBeenCalled();
  });
});
