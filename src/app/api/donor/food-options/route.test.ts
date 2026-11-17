import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { getFoodOptions } from "@/server/donor/food-options";
import { prismaFoodOptionsStore } from "@/server/donor/prisma-food-options-store";
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
vi.mock("@/server/donor/food-options", () => ({ getFoodOptions: vi.fn() }));
vi.mock("@/server/donor/prisma-food-options-store", () => ({ prismaFoodOptionsStore: {} }));

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

/** A complete answer as the service builds it: the allow-list, no ids, no flags. */
const OPTIONS = {
  categories: [
    {
      code: "COOKED_MEALS",
      name: "Cooked Meals",
      requiresPreparedTime: true,
      requiresStorageInfo: true,
    },
    {
      code: "FRESH_PRODUCE",
      name: "Whole Fresh Produce",
      requiresPreparedTime: false,
      requiresStorageInfo: false,
    },
  ],
  allergens: [{ code: "PEANUTS", name: "Peanuts" }],
  dietaryTags: [{ code: "HALAL", name: "Halal" }],
};

function service() {
  return vi.mocked(getFoodOptions);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  service().mockResolvedValue({ ok: true, options: OPTIONS });
});

describe("GET /api/donor/food-options", () => {
  it("answers 401 before touching the service when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(service()).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(service()).not.toHaveBeenCalled();
  });

  it("returns the options with Cache-Control: no-store", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // toEqual on the whole body: nothing beyond the three lists may appear.
    expect(await res.json()).toEqual(OPTIONS);
  });

  it("sends only the session actor id to the service, so no other donor's data can appear", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    // There is no id in the URL or body; the session is the only source.
    expect(service()).toHaveBeenCalledTimes(1);
    expect(service()).toHaveBeenCalledWith(
      { store: prismaFoodOptionsStore },
      { userId: donorActor.id },
    );
  });

  it("answers 404 when the service finds no live donor", async () => {
    service().mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await GET();

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({
      error: "NOT_FOUND",
      message: "The food options were not found.",
    });
    expect(body).not.toHaveProperty("categories");
  });

  it("answers 500 with a generic message and logs a safe summary only", async () => {
    service().mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await GET();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The food options could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Donor food options read failed");
      expect(details).toMatchObject({ errorName: "Error" });
      // Only the safe summary reaches the log: never the thrown message.
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("database is down");
    } finally {
      consoleError.mockRestore();
    }
  });
});
