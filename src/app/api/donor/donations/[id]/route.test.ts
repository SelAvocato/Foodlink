import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaDonationDetailStore } from "@/server/donor/prisma-donation-detail-store";
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
vi.mock("@/server/donor/prisma-donation-detail-store", () => ({
  prismaDonationDetailStore: { findReport: vi.fn() },
}));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

/** The DONOR view of fn_donation_report, including the two unfiltered timeline fields. */
function report() {
  return {
    generated_at: "2026-11-13T09:00:00.000Z",
    donation: {
      id: VALID_ID,
      food_name: "Chicken adobo",
      category: "Cooked meals",
      portions: 25,
      status: "POSTED",
      posted_at: "2026-11-13T08:00:00.000Z",
      accepted_at: null,
      closed_at: null,
    },
    donor: { name: "Test Bakery", donor_type: "ESTABLISHMENT" },
    volunteer: { first_name: "Ana", phone: "+639171111111" },
    pickup: {
      address: "12 Mabini St, Quezon City",
      pickup_start: "2026-11-14T08:00:00.000Z",
      pickup_end: "2026-11-14T10:00:00.000Z",
    },
    allergens: ["Peanuts"],
    pickup_inspection: null,
    exit: null,
    qr_scans: [],
    distribution: {
      entries: [
        {
          distributed_on: "2026-11-15",
          place: "Barangay Hall",
          group_served: "Street children",
          people_served: 20,
          portions_distributed: 25,
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
    assignments: null,
    timeline: [
      {
        type: "POSTED",
        from: "SCREENED",
        to: "POSTED",
        at: "2026-11-13T08:00:00.000Z",
        note: "internal admin note",
        metadata: { volunteerId: "volunteer-1" },
      },
    ],
    incidents: null,
  };
}

function get(id = VALID_ID): Promise<Response> {
  return GET(new Request(`http://localhost/api/donor/donations/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function findReport() {
  return vi.mocked(prismaDonationDetailStore.findReport);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  findReport().mockResolvedValue(report());
});

describe("GET /api/donor/donations/[id]", () => {
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

  it.each([
    ["missing", null],
    ["soft-deleted or foreign", undefined],
  ])("answers 404 with no report when the donation is %s for this donor", async (_label, value) => {
    // The store's EXISTS clause returns no row for a missing, soft-deleted or
    // foreign donation; the service turns both null and undefined into NOT_FOUND.
    findReport().mockResolvedValue(value);

    const res = await get();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
    expect(body).not.toHaveProperty("report");
    expect(findReport()).toHaveBeenCalledWith(VALID_ID, donorActor.id);
  });

  it("returns the report without note or metadata, with Cache-Control: no-store", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    // The fixture keeps assignments and incidents (raw function output); neither key
    // may reach the response.
    const expected = { ...report() } as Record<string, unknown>;
    delete expected.assignments;
    delete expected.incidents;
    expected.timeline = [
      { type: "POSTED", from: "SCREENED", to: "POSTED", at: "2026-11-13T08:00:00.000Z" },
    ];
    expect(body).toEqual({ report: expected });
    expect(body.report).not.toHaveProperty("assignments");
    expect(body.report).not.toHaveProperty("incidents");
    const logged = JSON.stringify(body);
    expect(logged).not.toContain("internal admin note");
    expect(logged).not.toContain("volunteerId");
    // The session donor id reaches the store; the DONOR role is fixed in the SQL.
    expect(findReport()).toHaveBeenCalledTimes(1);
    expect(findReport()).toHaveBeenCalledWith(VALID_ID, donorActor.id);
  });

  it("answers 500 with a generic message and logs no report content", async () => {
    findReport().mockResolvedValue({
      donation: { id: VALID_ID, status: 7 },
      donor: { name: "Maria Santos", phone: "+639170000000" },
      volunteer: { first_name: "Ana", phone: "+639171111111" },
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
      expect(label).toBe("Donor donation detail failed");
      expect(details).toMatchObject({ errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      // Report content and error messages never reach the log (the label itself is fine).
      for (const secret of ["Maria Santos", "+639170000000", "+639171111111", "unexpected shape"]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      consoleError.mockRestore();
    }
  });
});
