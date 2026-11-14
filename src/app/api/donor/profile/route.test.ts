import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaDonorProfileStore } from "@/server/donor/prisma-donor-profile-store";
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
vi.mock("@/server/donor/prisma-donor-profile-store", () => ({
  prismaDonorProfileStore: { findProfile: vi.fn() },
}));

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

/** The row the SQL returns: contact fields, address with pin and the proof line. */
function profileRow() {
  return {
    full_name: "Maria Santos",
    business_name: "Test Bakery",
    donor_type: "ESTABLISHMENT",
    email: "donor@example.com",
    status: "ACTIVE",
    contact_number: "+639171234567",
    street_line1: "12 Mabini St",
    street_line2: "Block 5",
    barangay: "Poblacion",
    city: "Quezon City",
    latitude: 14.5995,
    longitude: 120.9842,
    proof_type_name: "Business Permit",
    proof_status: "APPROVED",
  };
}

function expectedProfile() {
  return {
    fullName: "Maria Santos",
    businessName: "Test Bakery",
    donorType: "ESTABLISHMENT",
    email: "donor@example.com",
    status: "ACTIVE",
    contactNumber: "+639171234567",
    address: {
      streetLine1: "12 Mabini St",
      streetLine2: "Block 5",
      barangay: "Poblacion",
      city: "Quezon City",
      latitude: 14.5995,
      longitude: 120.9842,
    },
    proof: { documentTypeName: "Business Permit", status: "APPROVED" },
  };
}

function get(): Promise<Response> {
  // No id, no query and no body: the route only ever reads the session, so the test
  // sends no request input at all.
  return GET();
}

function findProfile() {
  return vi.mocked(prismaDonorProfileStore.findProfile);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  findProfile().mockResolvedValue(profileRow());
});

describe("GET /api/donor/profile", () => {
  it("answers 401 before touching the store when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(findProfile()).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(findProfile()).not.toHaveBeenCalled();
  });

  it("returns the profile with Cache-Control: no-store", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // toEqual on the whole body: nothing beyond { profile } may appear.
    expect(await res.json()).toEqual({ profile: expectedProfile() });
  });

  it("sends only the session actor id to the store, so no other donor's data can appear", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    // There is no id in the URL or body; the store is asked for exactly this donor.
    expect(findProfile()).toHaveBeenCalledTimes(1);
    expect(findProfile()).toHaveBeenCalledWith(donorActor.id);
    expect(await res.json()).toEqual({ profile: expectedProfile() });
  });

  it("answers 404 when the store finds no row", async () => {
    findProfile().mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: "NOT_FOUND",
      message: "The profile was not found.",
    });
    expect(body).not.toHaveProperty("profile");
    expect(findProfile()).toHaveBeenCalledWith(donorActor.id);
  });

  it("answers 500 with a generic message and logs neither the email nor the phone", async () => {
    // The row's latitude has the wrong type: the contract and the SQL disagree, which
    // is a bug, not a missing profile.
    findProfile().mockResolvedValue({ ...profileRow(), latitude: "14.5995" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The profile could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Donor profile read failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      // Only the safe summary reaches the log: never the row, its message, or contact data.
      for (const secret of [
        "donor@example.com",
        "+639171234567",
        "Maria Santos",
        "unexpected shape",
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
