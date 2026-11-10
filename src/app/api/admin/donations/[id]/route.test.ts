import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { prismaDonationDetailStore } from "@/server/admin/prisma-donation-detail-store";
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
vi.mock("@/server/admin/prisma-donation-detail-store", () => ({
  prismaDonationDetailStore: { findReport: vi.fn() },
}));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function report() {
  return {
    generated_at: "2026-11-09T09:00:00.000Z",
    donation: {
      id: VALID_ID,
      food_name: "Chicken adobo",
      category: "Cooked meals",
      portions: 25,
      status: "POSTED",
      posted_at: "2026-11-09T08:00:00.000Z",
      accepted_at: null,
      closed_at: null,
    },
    donor: {
      user_id: "donor-user-id",
      name: "Test Bakery",
      full_name: "Maria Santos",
      donor_type: "ESTABLISHMENT",
      phone: "+639170000000",
    },
    volunteer: null,
    pickup: {
      address: "12 Mabini St, Quezon City",
      pickup_start: "2026-11-10T08:00:00.000Z",
      pickup_end: "2026-11-10T10:00:00.000Z",
    },
    safety_checklist: {
      prepared_at: "2026-11-09T07:00:00.000Z",
      consume_by_at: "2026-11-10T12:00:00.000Z",
      storage_condition: "REFRIGERATED",
      storage_temperature_c: 4,
      packaging_intact: true,
      allergens_confirmed: true,
      completed_at: "2026-11-09T07:30:00.000Z",
    },
    allergens: ["Peanuts"],
    pickup_inspection: null,
    exit: null,
    qr_scans: [],
    distribution: {
      entries: [
        {
          distributed_on: "2026-11-10",
          place: "Barangay Hall",
          group_served: "Street children",
          people_served: 20,
          portions_distributed: 25,
          notes: "Handled with care",
        },
      ],
      unusable: [],
    },
    impact: {
      portions_donated: 25,
      portions_distributed: 25,
      portions_unusable: 0,
      people_served: 20,
    },
    assignments: [],
    timeline: [],
    incidents: [],
  };
}

function get(id = VALID_ID): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/donations/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function findReport() {
  return vi.mocked(prismaDonationDetailStore.findReport);
}

/** Every key in a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysOf(nested)]);
  }
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  findReport().mockResolvedValue(report());
});

describe("GET /api/admin/donations/[id]", () => {
  it("answers 401 before reading the id when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    // An invalid id would be a 400 if the params were read first.
    const res = await get("not-a-uuid");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(findReport()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "VOLUNTEER"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await get();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(findReport()).not.toHaveBeenCalled();
  });

  it.each(["not-a-uuid", "", "11111111111141118111111111111111"])(
    "answers 400 INVALID_REQUEST for the id %j",
    async (id) => {
      const res = await get(id);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: "INVALID_REQUEST",
        message: "The donation id is invalid.",
      });
      expect(findReport()).not.toHaveBeenCalled();
    },
  );

  it("answers 404 when the function returns no report", async () => {
    findReport().mockResolvedValue(null);

    const res = await get();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
    expect(findReport()).toHaveBeenCalledTimes(1);
  });

  it("returns the report unchanged with Cache-Control: no-store", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ report: report() });
    expect(findReport()).toHaveBeenCalledTimes(1);
    // Only the id reaches the store; the ADMIN role is fixed in the SQL, not a parameter.
    expect(findReport()).toHaveBeenCalledWith(VALID_ID);
    expect(findReport().mock.calls[0]).toHaveLength(1);
  });

  it("adds no keys, so no QR token or storage key can appear in the response", async () => {
    const res = await get();
    const body = await res.json();

    expect(body).toEqual({ report: report() });
    const keys = keysOf(body);
    for (const forbidden of ["qr_token", "qrToken", "storage_key", "storageKey"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  it("answers 500 with a generic message and logs no report content", async () => {
    findReport().mockResolvedValue({
      donation: { id: VALID_ID, status: 7 },
      donor: { name: "Maria Santos", phone: "+639170000000" },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The donation could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Admin donation detail failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      // Report content and error messages never reach the log (the label itself is fine).
      for (const secret of ["Maria Santos", "+639170000000", "status", "unexpected shape"]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
