import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/donations/transition-donation", () => {
  class DonationTransitionError extends Error {
    constructor(
      public readonly code:
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "FORBIDDEN_ACTOR"
        | "MISSING_PAYLOAD"
        | "VOLUNTEER_NOT_ACTIVE",
      message: string,
    ) {
      super(message);
      this.name = "DonationTransitionError";
    }
  }
  return { DonationTransitionError, prismaTransitionStore: {}, transitionDonation: vi.fn() };
});
import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { ScreeningDecisionTransitionInput } from "./decide-screening";
import { createAdminScreeningTransition } from "./admin-screening-transition";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const SCREENING_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "admin-1";
const REASON = "Mold on the surface.";

const transitionMock = vi.mocked(transitionDonation);

function decide(overrides: Partial<ScreeningDecisionTransitionInput> = {}) {
  return createAdminScreeningTransition()({
    donationId: DONATION_ID,
    to: "SCREENED",
    screeningId: SCREENING_ID,
    actorId: ACTOR_ID,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionMock.mockResolvedValue({ from: "DRAFT", to: "SCREENED" });
});

describe("createAdminScreeningTransition", () => {
  it("maps PASS to a SCREENED call with the Admin actor and no reason", async () => {
    const result = await decide();

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "SCREENED",
      { id: ACTOR_ID, role: "ADMIN" },
      {
        screeningId: SCREENING_ID,
        eventNote: "Photo passed admin review.",
        metadata: { source: "admin_screening_review", decision: "PASS" },
      },
    );
    const [, , , , payload] = transitionMock.mock.calls[0];
    expect(payload).not.toHaveProperty("reason");
  });

  it("maps REJECT to a REJECTED call carrying the reason", async () => {
    const result = await decide({ to: "REJECTED", reason: REASON });

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "REJECTED",
      { id: ACTOR_ID, role: "ADMIN" },
      {
        screeningId: SCREENING_ID,
        reason: REASON,
        eventNote: "Photo rejected in admin review.",
        metadata: { source: "admin_screening_review", decision: "REJECT" },
      },
    );
  });

  it.each([["NOT_FOUND"], ["INVALID_TRANSITION"]] as const)(
    "answers { ok: false, error: %s } for a matching transition error",
    async (code) => {
      transitionMock.mockRejectedValue(new DonationTransitionError(code, "refused"));

      await expect(decide()).resolves.toEqual({ ok: false, error: code });
    },
  );

  it.each([["FORBIDDEN_ACTOR"], ["MISSING_PAYLOAD"], ["VOLUNTEER_NOT_ACTIVE"]] as const)(
    "rethrows a %s transition error because it would be a bug here",
    async (code) => {
      transitionMock.mockRejectedValue(new DonationTransitionError(code, "bug"));

      await expect(decide()).rejects.toMatchObject({ name: "DonationTransitionError", code });
    },
  );

  it("rethrows an error that is not a transition error", async () => {
    const failure = new Error("connection lost");
    transitionMock.mockRejectedValue(failure);

    await expect(decide()).rejects.toBe(failure);
  });
});
