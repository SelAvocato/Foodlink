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
import { createPostTransition } from "./post-transition";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "donor-1";
const QR_TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const transitionMock = vi.mocked(transitionDonation);

function post(qrToken = QR_TOKEN) {
  return createPostTransition()({ donationId: DONATION_ID, donorId: DONOR_ID, qrToken });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionMock.mockResolvedValue({ from: "SCREENED", to: "POSTED" });
});

describe("createPostTransition", () => {
  it("posts as the donor with the QR token and the event note", async () => {
    const result = await post();

    expect(result).toEqual({ ok: true });
    expect(transitionMock).toHaveBeenCalledTimes(1);
    expect(transitionMock).toHaveBeenCalledWith(
      { store: prismaTransitionStore },
      DONATION_ID,
      "POSTED",
      { id: DONOR_ID, role: "DONOR" },
      { qrToken: QR_TOKEN, eventNote: "Donation posted." },
    );
    const [, , , actor, payload] = transitionMock.mock.calls[0];
    expect(actor).toEqual({ id: DONOR_ID, role: "DONOR" });
    expect(payload?.qrToken).toBe(QR_TOKEN);
  });

  it.each([
    ["NOT_FOUND"],
    ["INVALID_TRANSITION"],
    ["FORBIDDEN_ACTOR"],
  ] as const)("answers { ok: false, error: %s } for a matching transition error", async (code) => {
    transitionMock.mockRejectedValue(new DonationTransitionError(code, "refused"));

    await expect(post()).resolves.toEqual({ ok: false, error: code });
  });

  it("rethrows a MISSING_PAYLOAD transition error because it would be a bug here", async () => {
    transitionMock.mockRejectedValue(new DonationTransitionError("MISSING_PAYLOAD", "bug"));

    await expect(post()).rejects.toMatchObject({ name: "DonationTransitionError", code: "MISSING_PAYLOAD" });
  });

  it("rethrows an error that is not a transition error (for example a unique violation)", async () => {
    const failure = new Error("unique constraint on qr_token");
    transitionMock.mockRejectedValue(failure);

    await expect(post()).rejects.toBe(failure);
  });
});
