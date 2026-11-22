import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import {
  deleteDistributionEntry,
  updateDistributionEntry,
} from "@/server/volunteer/distribution-entries";
import { DELETE, PATCH } from "./route";

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
  updateDistributionEntry: vi.fn(),
  deleteDistributionEntry: vi.fn(),
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

const entry: DistributionEntryView = {
  id: ENTRY_ID,
  date: "2026-11-18",
  place: "Barangay hall",
  groupServed: "families",
  peopleServed: 30,
  portionsDistributed: 10,
  portionsUnusable: 0,
  unusableReason: null,
  notes: null,
};
const progress = {
  accountedPortions: 10,
  totalPortions: 20,
  remainingPortions: 10,
};

function request(body?: unknown, method = "PATCH") {
  return new Request(
    `http://localhost/api/volunteer/donations/${DONATION_ID}/distribution-entries/${ENTRY_ID}`,
    {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

function context(id = DONATION_ID, entryId = ENTRY_ID) {
  return { params: Promise.resolve({ id, entryId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  vi.mocked(updateDistributionEntry).mockResolvedValue({ ok: true, entry, progress });
  vi.mocked(deleteDistributionEntry).mockResolvedValue({ ok: true, entry, progress });
});

describe("PATCH /api/volunteer/donations/[id]/distribution-entries/[entryId]", () => {
  it("answers 401 before reading params or the body", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await PATCH(request("{not json"), context("bad", "bad"));

    expect(res.status).toBe(401);
    expect(updateDistributionEntry).not.toHaveBeenCalled();
  });

  it("answers 403 for an admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await PATCH(request({ portionsDistributed: 10 }), context());

    expect(res.status).toBe(403);
    expect(updateDistributionEntry).not.toHaveBeenCalled();
  });

  it("validates both ids before the store", async () => {
    const res = await PATCH(request({ portionsDistributed: 10 }), context("bad", ENTRY_ID));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });

    const res2 = await PATCH(request({ portionsDistributed: 10 }), context(DONATION_ID, "bad"));

    expect(res2.status).toBe(400);
    expect(await res2.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The distribution entry id is invalid.",
    });
    expect(updateDistributionEntry).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, an empty patch and an invalid patch", async () => {
    expect((await PATCH(request("{not json"), context())).status).toBe(400);
    expect((await PATCH(request({}), context())).status).toBe(400);
    expect((await PATCH(request({ portionsDistributed: -1 }), context())).status).toBe(400);
    expect(updateDistributionEntry).not.toHaveBeenCalled();
  });

  it("updates the entry for the session volunteer", async () => {
    const res = await PATCH(request({ portionsDistributed: 10 }), context());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entry, progress });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(updateDistributionEntry).toHaveBeenCalledWith(
      { store: {} },
      {
        volunteerId: volunteerActor.id,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
        input: { portionsDistributed: 10 },
      },
    );
  });

  it.each([
    ["NOT_FOUND", 404, "The distribution entry was not found."],
    ["INVALID_STATE", 409, "Distribution entries can only be changed after delivery."],
    ["PORTIONS_EXCEEDED", 409, "The recorded portions would exceed the donation's portions."],
    ["INVALID_ENTRY", 400, "The distribution entry is invalid."],
  ] as const)("maps %s to %i", async (error, status, message) => {
    vi.mocked(updateDistributionEntry).mockResolvedValue({ ok: false, error });

    const res = await PATCH(request({ portionsDistributed: 10 }), context());

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(updateDistributionEntry).mockRejectedValue(
      new Error("database password leaked"),
    );

    const res = await PATCH(request({ portionsDistributed: 10 }), context());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The distribution entry could not be saved.",
    });
    expect(spy).toHaveBeenCalledWith("Update distribution entry failed", {
      donationId: DONATION_ID,
      entryId: ENTRY_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("password");
    spy.mockRestore();
  });
});

describe("DELETE /api/volunteer/donations/[id]/distribution-entries/[entryId]", () => {
  it("answers 401 before reading params", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await DELETE(request(undefined, "DELETE"), context("bad", "bad"));

    expect(res.status).toBe(401);
    expect(deleteDistributionEntry).not.toHaveBeenCalled();
  });

  it("answers 403 for a donor", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await DELETE(request(undefined, "DELETE"), context());

    expect(res.status).toBe(403);
    expect(deleteDistributionEntry).not.toHaveBeenCalled();
  });

  it("validates both ids before the store", async () => {
    const res = await DELETE(request(undefined, "DELETE"), context("bad", ENTRY_ID));

    expect(res.status).toBe(400);
    expect(deleteDistributionEntry).not.toHaveBeenCalled();
  });

  it("deletes the entry for the session volunteer", async () => {
    const res = await DELETE(request(undefined, "DELETE"), context());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entry, progress });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(deleteDistributionEntry).toHaveBeenCalledWith(
      { store: {} },
      {
        volunteerId: volunteerActor.id,
        donationId: DONATION_ID,
        entryId: ENTRY_ID,
      },
    );
  });

  it.each([
    ["NOT_FOUND", 404, "The distribution entry was not found."],
    ["INVALID_STATE", 409, "Distribution entries can only be changed after delivery."],
    ["PORTIONS_EXCEEDED", 409, "The recorded portions would exceed the donation's portions."],
    ["INVALID_ENTRY", 400, "The distribution entry is invalid."],
  ] as const)("maps %s to %i", async (error, status, message) => {
    vi.mocked(deleteDistributionEntry).mockResolvedValue({ ok: false, error });

    const res = await DELETE(request(undefined, "DELETE"), context());

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(deleteDistributionEntry).mockRejectedValue(
      new Error("database password leaked"),
    );

    const res = await DELETE(request(undefined, "DELETE"), context());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The distribution entry could not be deleted.",
    });
    expect(spy).toHaveBeenCalledWith("Delete distribution entry failed", {
      donationId: DONATION_ID,
      entryId: ENTRY_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("password");
    spy.mockRestore();
  });
});
