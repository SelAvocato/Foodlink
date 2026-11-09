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
import { createCancelTransition } from "./cancel-transition";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "donor-1";
const REASON = "We are travelling this week.";

const transitionMock = vi.mocked(transitionDonation);

function cancel(reason?: string) {
  return createCancelTransition()({
    donationId: DONATION_ID,
    donorId: DONOR_ID,
    ...(reason === undefined ? {} : { reason }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionMock.mockResolvedValue({ from: "POSTED", to: "CANCELLED" });
});

describe("createCancelTransition", () => {
  it("cancels as the donor with the event note and no reason when none was given", async () => {
    const result = await cancel();

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "CANCELLED",
      { id: DONOR_ID, role: "DONOR" },
      { eventNote: "Donation cancelled by the donor." },
    );
    const [, , , actor, payload] = transitionMock.mock.calls[0];
    expect(actor).toEqual({ id: DONOR_ID, role: "DONOR" });
    expect(payload?.reason).toBeUndefined();
  });

  it("includes the reason in the payload when one was given", async () => {
    await cancel(REASON);

    const [, , , , payload] = transitionMock.mock.calls[0];
    expect(payload).toEqual({ reason: REASON, eventNote: "Donation cancelled by the donor." });
  });

  it.each([
    ["NOT_FOUND"],
    ["INVALID_TRANSITION"],
    ["FORBIDDEN_ACTOR"],
  ] as const)("answers { ok: false, error: %s } for a matching transition error", async (code) => {
    transitionMock.mockRejectedValue(new DonationTransitionError(code, "refused"));

    await expect(cancel()).resolves.toEqual({ ok: false, error: code });
  });

  it("rethrows a MISSING_PAYLOAD transition error because it would be a bug here", async () => {
    transitionMock.mockRejectedValue(new DonationTransitionError("MISSING_PAYLOAD", "bug"));

    await expect(cancel()).rejects.toMatchObject({
      name: "DonationTransitionError",
      code: "MISSING_PAYLOAD",
    });
  });

  it("rethrows an error that is not a transition error (for example a database failure)", async () => {
    const failure = new Error("connection lost");
    transitionMock.mockRejectedValue(failure);

    await expect(cancel()).rejects.toBe(failure);
  });
});
