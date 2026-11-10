import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    transitionDonation: vi.fn(),
    requireRole: vi.fn(),
    AuthorizationError: class AuthorizationError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
    DonationTransitionError: class DonationTransitionError extends Error {
        code: string;
        constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
}));

vi.mock("@/server/auth/require-role", () => ({
    AuthorizationError: mocks.AuthorizationError,
    requireRole: mocks.requireRole,
}));
vi.mock("@/server/donations/transition-donation", () => ({
    DonationTransitionError: mocks.DonationTransitionError,
    prismaTransitionStore: {},
    transitionDonation: mocks.transitionDonation,
}));

import { POST } from "./route";

const donationId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ id: donationId }) };
const adminActor = {
    id: "admin-1",
    email: "admin@foodlink.test",
    name: "FoodLink Admin",
    role: "ADMIN",
    status: "ACTIVE",
};

function request(body: unknown) {
    return new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(adminActor);
    mocks.transitionDonation.mockResolvedValue({ from: "POSTED", to: "ACCEPTED" });
});

describe("POST /api/admin/donations/[id]/accept", () => {
    it("requires an admin session", async () => {
        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("FORBIDDEN", "Not allowed"));
        const response = await POST(request({}), context);
        expect(response.status).toBe(403);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();

        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("UNAUTHENTICATED", "Sign in"));
        const unauthenticated = await POST(request({}), context);
        expect(unauthenticated.status).toBe(401);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("rejects unknown fields and invalid ids", async () => {
        const extra = await POST(request({ volunteerId: "nope" }), context);
        expect(extra.status).toBe(400);

        const badId = await POST(request({}), { params: Promise.resolve({ id: "not-a-uuid" }) });
        expect(badId.status).toBe(400);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("accepts as the session admin and returns the transition result", async () => {
        const response = await POST(request({}), context);
        expect(response.status).toBe(200);
        expect(mocks.requireRole).toHaveBeenCalledWith(["ADMIN"]);
        expect(mocks.transitionDonation).toHaveBeenCalledWith(
            { store: {} },
            donationId,
            "ACCEPTED",
            adminActor,
            {},
        );
        expect(await response.json()).toEqual({ from: "POSTED", to: "ACCEPTED" });
    });

    it("returns 409 when the pickup window has passed or the row was lost", async () => {
        mocks.transitionDonation.mockRejectedValue(
            new mocks.DonationTransitionError("INVALID_TRANSITION", "Donation pickup window has passed"),
        );
        const response = await POST(request({}), context);
        expect(response.status).toBe(409);
    });

    it("returns 404 for a missing donation", async () => {
        mocks.transitionDonation.mockRejectedValue(new mocks.DonationTransitionError("NOT_FOUND", "Donation not found"));
        const response = await POST(request({}), context);
        expect(response.status).toBe(404);
    });
});
