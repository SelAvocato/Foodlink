import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { createDistributionEntry } from "@/server/volunteer/distribution-entries";
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
vi.mock("@/server/volunteer/distribution-entries", () => ({
  createDistributionEntry: vi.fn(),
}));
vi.mock("@/server/volunteer/prisma-distribution-entry-store", () => ({
  prismaDistributionEntryStore: {},
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const ENTRY_ID = "12345678-3456-4789-8abc-def012345678";
const volunteerActor: AuthenticatedActor = {
  id: "9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

const validBody = {
  date: "2026-11-18",
  place: "Barangay hall",
  groupServed: "families",
  peopleServed: 30,
  portionsDistributed: 12,
  portionsUnusable: 2,
  unusableReason: "damaged",
};

const entry: DistributionEntryView = {
  id: ENTRY_ID,
  date: "2026-11-18",
  place: "Barangay hall",
  groupServed: "families",
  peopleServed: 30,
  portionsDistributed: 12,
  portionsUnusable: 2,
  unusableReason: "damaged",
  notes: null,
};
const progress = {
  accountedPortions: 14,
  totalPortions: 20,
  remainingPortions: 6,
};

function post(body: unknown, id = DONATION_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/volunteer/donations/${id}/distribution-entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  vi.mocked(createDistributionEntry).mockResolvedValue({
    ok: true,
    entry,
    progress,
  });
});

describe("POST /api/volunteer/donations/[id]/distribution-entries", () => {
  it("answers 401 before reading params or the body without a session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post("{not json", "not-a-uuid");

    expect(res.status).toBe(401);
    expect(createDistributionEntry).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post(validBody);

    expect(res.status).toBe(403);
    expect(createDistributionEntry).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid donation id before the store", async () => {
    const res = await post(validBody, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(createDistributionEntry).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and an invalid body", async () => {
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...validBody, portionsDistributed: -1 })).status).toBe(400);
    expect((await post({ ...validBody, place: "House of Maria Santos" })).status).toBe(400);
    expect(createDistributionEntry).not.toHaveBeenCalled();
  });

  it("records the entry for the session volunteer", async () => {
    const res = await post(validBody);

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ entry, progress });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(createDistributionEntry).toHaveBeenCalledWith(
      { store: {} },
      {
        volunteerId: volunteerActor.id,
        donationId: DONATION_ID,
        input: {
          date: "2026-11-18",
          place: "Barangay hall",
          groupServed: "families",
          peopleServed: 30,
          portionsDistributed: 12,
          portionsUnusable: 2,
          unusableReason: "damaged",
        },
      },
    );
  });

  it.each([
    ["NOT_FOUND", 404, "The donation was not found."],
    ["INVALID_STATE", 409, "Distribution entries can only be recorded after delivery."],
    ["PORTIONS_EXCEEDED", 409, "The recorded portions would exceed the donation's portions."],
    ["INVALID_ENTRY", 400, "The distribution entry is invalid."],
  ] as const)("maps %s to %i", async (error, status, message) => {
    vi.mocked(createDistributionEntry).mockResolvedValue({ ok: false, error });

    const res = await post(validBody);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createDistributionEntry).mockRejectedValue(
      new Error(`database password leaked ${JSON.stringify(validBody)}`),
    );

    const res = await post(validBody);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The distribution entry could not be saved.",
    });
    expect(spy).toHaveBeenCalledWith("Create distribution entry failed", {
      donationId: DONATION_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("password");
    spy.mockRestore();
  });
});
