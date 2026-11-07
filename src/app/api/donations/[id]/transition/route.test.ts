import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    transitionDonation: vi.fn(),
    DonationTransitionError: class DonationTransitionError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/server/donations/transition-donation", () => ({
    DonationTransitionError: mocks.DonationTransitionError,
    prismaTransitionStore: {},
    transitionDonation: mocks.transitionDonation,
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };
const activeSession = {
    user: { id: "admin-1", role: "ADMIN", status: "ACTIVE" },
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue(activeSession);
    mocks.transitionDonation.mockResolvedValue({ from: "POSTED", to: "DECLINED" });
});

describe("POST /api/donations/[id]/transition", () => {
    it("requires an active authenticated session", async () => {
        mocks.getServerSession.mockResolvedValue(null);
        const response = await POST(new Request("http://localhost"), context);
        expect(response.status).toBe(401);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("rejects unknown body fields", async () => {
        const response = await POST(
            new Request("http://localhost", {
                method: "POST",
                body: JSON.stringify({ to: "DECLINED", unexpected: true }),
                headers: { "content-type": "application/json" },
            }),
            context,
        );
        expect(response.status).toBe(400);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("passes the verified session actor and transition payload to the service", async () => {
        const response = await POST(
            new Request("http://localhost", {
                method: "POST",
                body: JSON.stringify({ to: "DECLINED", reason: "Unsafe food" }),
                headers: { "content-type": "application/json" },
            }),
            context,
        );
        expect(response.status).toBe(200);
        expect(mocks.transitionDonation).toHaveBeenCalledWith(
            { store: {} },
            "11111111-1111-4111-8111-111111111111",
            "DECLINED",
            { id: "admin-1", role: "ADMIN" },
            { reason: "Unsafe food" },
        );
    });

    it("maps service authorization errors to 403", async () => {
        const serviceError = new mocks.DonationTransitionError("FORBIDDEN_ACTOR", "Donor does not own this donation");
        mocks.transitionDonation.mockRejectedValue(serviceError);
        const response = await POST(
            new Request("http://localhost", {
                method: "POST",
                body: JSON.stringify({ to: "CANCELLED" }),
                headers: { "content-type": "application/json" },
            }),
            context,
        );
        expect(response.status).toBe(403);
    });
});
