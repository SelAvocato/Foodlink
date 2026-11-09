import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: {} }));
vi.mock("@/server/donations/transition-donation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/donations/transition-donation")>();
  return { ...actual, transitionDonation: vi.fn() };
});
import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import type { ScreeningTransitionInput } from "./screen-draft-photo";
import { createScreeningTransition } from "./screening-transition";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const SCREENING_ID = "22222222-2222-4222-8222-222222222222";
const REASON = "Photo failed visual screening: mold.";

const transitionMock = vi.mocked(transitionDonation);

function screen(overrides: Partial<ScreeningTransitionInput> = {}) {
  return createScreeningTransition()({
    donationId: DONATION_ID,
    to: "SCREENED",
    screeningId: SCREENING_ID,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionMock.mockResolvedValue({ from: "DRAFT", to: "SCREENED" });
});

describe("createScreeningTransition", () => {
  it("maps PASS to a SCREENED call with a null actor and the screening payload", async () => {
    const result = await screen();

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "SCREENED",
      null,
      {
        screeningId: SCREENING_ID,
        eventNote: "Photo passed automatic screening.",
        metadata: { source: "food_screening" },
      },
    );
    const [, , , actor, payload] = transitionMock.mock.calls[0];
    expect(actor).toBeNull();
    expect(payload).not.toHaveProperty("reason");
  });

  it("maps FLAG to a REJECTED call carrying the reason", async () => {
    const result = await screen({ to: "REJECTED", reason: REASON });

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "REJECTED",
      null,
      {
        screeningId: SCREENING_ID,
        reason: REASON,
        eventNote: "Photo failed visual screening.",
        metadata: { source: "food_screening" },
      },
    );
  });

  it.each([["NOT_FOUND"], ["INVALID_TRANSITION"]] as const)(
    "answers { ok: false, error: %s } for a matching transition error",
    async (code) => {
      transitionMock.mockRejectedValue(new DonationTransitionError(code, "refused"));

      await expect(screen()).resolves.toEqual({ ok: false, error: code });
    },
  );

  it.each([["FORBIDDEN_ACTOR"], ["MISSING_PAYLOAD"]] as const)(
    "rethrows a %s transition error because it would be a bug here",
    async (code) => {
      transitionMock.mockRejectedValue(new DonationTransitionError(code, "bug"));

      await expect(screen()).rejects.toMatchObject({ name: "DonationTransitionError", code });
    },
  );

  it("rethrows an error that is not a transition error", async () => {
    const failure = new Error("connection lost");
    transitionMock.mockRejectedValue(failure);

    await expect(screen()).rejects.toBe(failure);
  });
});
