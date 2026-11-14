import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaDonorProfileStore } from "@/server/donor/prisma-donor-profile-store";
import { prismaDonorProfileUpdateStore } from "@/server/donor/prisma-donor-profile-update-store";
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
vi.mock("@/server/donor/prisma-donor-profile-store", () => ({
  prismaDonorProfileStore: { findProfile: vi.fn() },
}));
vi.mock("@/server/donor/prisma-donor-profile-update-store", () => ({
  prismaDonorProfileUpdateStore: { transaction: vi.fn() },
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

/** The PUT body: contact number and the pickup address with its map pin. */
const VALID_BODY = {
  contactNumber: "+639171234567",
  address: {
    streetLine1: "12 Mabini St",
    streetLine2: "Block 5",
    barangay: "Poblacion",
    city: "Quezon City",
    latitude: 14.5995,
    longitude: 120.9842,
  },
};

/** The locked row before the save: a different number, an address with no pin. */
function lockedUser() {
  return {
    contactNumber: "+639170000000",
    addressId: "address-old",
    address: {
      streetLine1: "10 Old St",
      streetLine2: null,
      barangay: null,
      city: "Quezon City",
      provinceOrState: null,
      postalCode: null,
      countryCode: "PH",
      latitude: null,
      longitude: null,
    },
  };
}

/** The store's transaction adapter the real service runs against: no database here. */
const tx = {
  getUserLocked: vi.fn(),
  insertAddress: vi.fn(),
  updateUser: vi.fn(),
  deleteAddressIfUnshared: vi.fn(),
  insertAudit: vi.fn(),
};

function transaction() {
  return vi.mocked(prismaDonorProfileUpdateStore.transaction);
}

function put(body: string | unknown): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/donor/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
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

describe("PUT /api/donor/profile", () => {
  beforeEach(() => {
    // The real service runs against this fake transaction; nothing touches a database.
    // Every tx method is re-set here because the outer beforeEach clears all mocks.
    transaction().mockImplementation(async (work) => work(tx));
    tx.getUserLocked.mockResolvedValue(lockedUser());
    tx.insertAddress.mockResolvedValue({ id: "address-new" });
    tx.updateUser.mockResolvedValue(undefined);
    tx.deleteAddressIfUnshared.mockResolvedValue(undefined);
    tx.insertAudit.mockResolvedValue(undefined);
  });

  it("answers 401 before opening the store when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await put(VALID_BODY);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(transaction()).not.toHaveBeenCalled();
    expect(findProfile()).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s and never opens the store",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );

      const res = await put(VALID_BODY);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(transaction()).not.toHaveBeenCalled();
      expect(findProfile()).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["email", "other@example.com"],
    ["donorType", "INDIVIDUAL"],
    ["status", "ACTIVE"],
    ["role", "ADMIN"],
    ["addressId", "address-2"],
    ["userId", "user-2"],
  ] as const)(
    "answers 400 for an unknown %s in the body and never opens the store",
    async (key, value) => {
      const res = await put({ ...VALID_BODY, [key]: value });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.message).toBe("The profile update is invalid.");
      expect(transaction()).not.toHaveBeenCalled();
      expect(findProfile()).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["provinceOrState", "Metro Manila"],
    ["postalCode", "1101"],
    ["countryCode", "PH"],
  ] as const)(
    "answers 400 when the address carries %s, a column the profile never edits",
    async (key, value) => {
      const res = await put({ ...VALID_BODY, address: { ...VALID_BODY.address, [key]: value } });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.message).toBe("The profile update is invalid.");
      expect(transaction()).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for a contact number the database would refuse", async () => {
    const res = await put({ ...VALID_BODY, contactNumber: "123" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.message).toBe("The profile update is invalid.");
    expect(transaction()).not.toHaveBeenCalled();
  });

  it("answers 400 when only one map-pin coordinate is sent", async () => {
    const res = await put({
      ...VALID_BODY,
      address: { ...VALID_BODY.address, longitude: undefined },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.message).toBe("The profile update is invalid.");
    expect(transaction()).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    const res = await put("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(transaction()).not.toHaveBeenCalled();
    expect(findProfile()).not.toHaveBeenCalled();
  });

  it("saves, re-reads and answers 200 with Cache-Control: no-store", async () => {
    const res = await put(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // toEqual on the whole body: nothing beyond { profile } may appear.
    expect(await res.json()).toEqual({ profile: expectedProfile() });
    // The whole save ran in one transaction: lock, insert, repoint, guarded delete, audit.
    expect(transaction()).toHaveBeenCalledTimes(1);
    expect(tx.insertAddress).toHaveBeenCalledTimes(1);
    expect(tx.updateUser).toHaveBeenCalledTimes(1);
    expect(tx.deleteAddressIfUnshared).toHaveBeenCalledWith("address-old");
    expect(tx.insertAudit).toHaveBeenCalledTimes(1);
    // And the response is the re-read row, not an echo of the body.
    expect(findProfile()).toHaveBeenCalledWith(donorActor.id);
  });

  it("passes only the session actor id to the store, so no other donor's profile can be saved", async () => {
    const res = await put(VALID_BODY);

    expect(res.status).toBe(200);
    // There is no id in the URL or in the body: the session is the only source.
    expect(transaction()).toHaveBeenCalledTimes(1);
    expect(tx.getUserLocked).toHaveBeenCalledWith(donorActor.id);
    expect(tx.updateUser).toHaveBeenCalledWith(donorActor.id, expect.anything());
    // One audit row, and only the changed field names go into it.
    expect(tx.insertAudit).toHaveBeenCalledWith({
      actorUserId: donorActor.id,
      changed: ["contactNumber", "address"],
    });
  });

  it("answers 404 when the locked user row is missing", async () => {
    tx.getUserLocked.mockResolvedValue(null);

    const res = await put(VALID_BODY);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The profile was not found.",
    });
    expect(tx.insertAddress).not.toHaveBeenCalled();
    expect(findProfile()).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic message and logs neither the number nor the street", async () => {
    tx.insertAddress.mockRejectedValue(new Error("the insert exploded"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await put(VALID_BODY);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The profile could not be saved.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Donor profile update failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      // Only the safe summary reaches the log: never the body, its values or the email.
      for (const secret of [
        "+639171234567",
        "+639170000000",
        "12 Mabini St",
        "10 Old St",
        "donor@example.com",
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });

  it("answers 500 when the profile cannot be re-read after a committed save", async () => {
    findProfile().mockResolvedValue(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await put(VALID_BODY);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The profile could not be saved.",
      });
      // The save itself ran and finished before the re-read failed.
      expect(transaction()).toHaveBeenCalledTimes(1);
      expect(tx.insertAudit).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0][0]).toBe("Donor profile update failed");
    } finally {
      consoleError.mockRestore();
    }
  });
});
