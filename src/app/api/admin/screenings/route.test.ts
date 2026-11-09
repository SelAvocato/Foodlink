import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import type { ScreeningQueueItem } from "@/contracts/screening-queue";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { listScreeningQueue } from "@/server/screening/review-queue";
import { createServerStorage } from "@/server/storage";
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
vi.mock("@/server/screening/review-queue", () => ({ listScreeningQueue: vi.fn() }));
vi.mock("@/server/screening/prisma-review-queue-store", () => ({ prismaReviewQueueStore: {} }));
const { getSignedUrl } = vi.hoisted(() => ({
  getSignedUrl: vi.fn(() => Promise.resolve("https://signed.example/queue-photo.jpg?token=abc")),
}));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({ getSignedUrl })) }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function queueItem(overrides: Partial<ScreeningQueueItem> = {}): ScreeningQueueItem {
  return {
    screeningId: "screen-1",
    donationId: VALID_ID,
    createdAt: new Date("2026-11-05T08:00:00.000Z"),
    confidence: 0.85,
    signs: ["no visible mold"],
    notes: null,
    donation: { foodName: "Beef stew", portions: 12, categoryCode: "cooked_meals" },
    checklist: null,
    photoUrl: "https://signed.example/queue-photo.jpg?token=abc",
    ...overrides,
  };
}

function get(query = ""): Promise<Response> {
  return GET(new Request(`http://localhost/api/admin/screenings${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(listScreeningQueue).mockResolvedValue([]);
});

describe("GET /api/admin/screenings", () => {
  it("answers 401 before reading the query when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    // The query is deliberately invalid: reading it first would answer 400.
    const res = await get("?limit=0");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(listScreeningQueue).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "VOLUNTEER"] as const)(
    "answers 403 for a signed-in %s without reading the query",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );

      const res = await get("?limit=0");

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
      expect(listScreeningQueue).not.toHaveBeenCalled();
    },
  );

  it.each(["0", "101", "abc"])("answers 400 for the bad limit %s", async (limit) => {
    const res = await get(`?limit=${limit}`);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.message).toBe("The screening queue query is invalid.");
    expect(Array.isArray(body.details.fieldErrors.limit)).toBe(true);
    expect(body.details.fieldErrors.limit.length).toBeGreaterThan(0);
    expect(listScreeningQueue).not.toHaveBeenCalled();
  });

  it("answers 400 for an unknown query field", async () => {
    const res = await get("?status=DRAFT");

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("status");
    expect(listScreeningQueue).not.toHaveBeenCalled();
  });

  it("returns the queue with the default limit and no-store, signing through the shared helper", async () => {
    const items = [
      queueItem(),
      queueItem({
        screeningId: "screen-2",
        donationId: "22222222-2222-4222-8222-222222222222",
        checklist: {
          preparedAt: new Date("2026-11-04T06:00:00.000Z"),
          consumeByAt: new Date("2026-11-06T18:00:00.000Z"),
          storageCondition: "REFRIGERATED",
          storageTemperatureC: 4.5,
          packagingIntact: true,
          allergensConfirmed: true,
          notCustomerPlateLeftovers: true,
          completedAt: new Date("2026-11-04T07:00:00.000Z"),
        },
      }),
    ];
    vi.mocked(listScreeningQueue).mockResolvedValue(items);

    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // Dates travel as ISO strings, exactly as JSON.stringify renders them.
    expect(await res.json()).toEqual(JSON.parse(JSON.stringify({ screenings: items })));
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(createServerStorage).toHaveBeenCalledTimes(1);
    expect(listScreeningQueue).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(listScreeningQueue).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.signPhoto).toBeTypeOf("function");
    expect(input).toEqual({ limit: 20 });
  });

  it("signs with the shared storage helper and the 300-second expiry", async () => {
    vi.mocked(listScreeningQueue).mockResolvedValue([queueItem({ photoUrl: null })]);

    const res = await get();
    expect(res.status).toBe(200);

    const [deps] = vi.mocked(listScreeningQueue).mock.calls[0];
    await deps.signPhoto("food-photos/photo.jpg");
    expect(getSignedUrl).toHaveBeenCalledWith("food-photos/photo.jpg", 300);
  });

  it("passes the parsed limit to the service", async () => {
    const res = await get("?limit=10");

    expect(res.status).toBe(200);
    const [, input] = vi.mocked(listScreeningQueue).mock.calls[0];
    expect(input).toEqual({ limit: 10 });
  });

  it("answers 200 with an empty array when the queue is empty", async () => {
    const res = await get();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ screenings: [] });
  });

  it("never contains email, phone, address or storage key fields in the response", async () => {
    vi.mocked(listScreeningQueue).mockResolvedValue([
      queueItem({
        checklist: {
          preparedAt: new Date("2026-11-04T06:00:00.000Z"),
          consumeByAt: new Date("2026-11-06T18:00:00.000Z"),
          storageCondition: "REFRIGERATED",
          storageTemperatureC: 4.5,
          packagingIntact: true,
          allergensConfirmed: true,
          notCustomerPlateLeftovers: true,
          completedAt: new Date("2026-11-04T07:00:00.000Z"),
        },
      }),
    ]);

    const res = await get();
    const text = JSON.stringify(await res.json());

    expect(text).not.toContain("email");
    expect(text).not.toContain("phone");
    expect(text).not.toContain("address");
    expect(text).not.toContain("storage_key");
    expect(text).not.toContain("storageKey");
    expect(text).not.toContain("donorId");
    expect(text).not.toContain("userId");
    expect(text).not.toContain("donor@example.com");
    expect(text).not.toContain("09171234567");
  });

  it("answers 500 with a generic message and a log-safe summary", async () => {
    vi.mocked(listScreeningQueue).mockRejectedValue(
      new Error("storage exploded https://signed.example?token=SECRETVALUE"),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await get();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "INTERNAL_ERROR",
      message: "The screening queue could not be loaded.",
    });
    expect(JSON.stringify(body)).not.toContain("SECRETVALUE");
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Screening queue failed");
    expect(details).toEqual({ errorName: "Error" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("storage exploded");
    expect(logged).not.toContain("SECRETVALUE");
    consoleError.mockRestore();
  });
});
