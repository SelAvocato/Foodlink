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

const context = { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({
        id: "admin-1",
        email: "admin@foodlink.test",
        name: "FoodLink Admin",
        role: "ADMIN",
        status: "ACTIVE",
    });
    mocks.transitionDonation.mockResolvedValue({ from: "POSTED", to: "DECLINED" });
});

describe("POST /api/donations/[id]/transition", () => {
    it("requires an active authenticated session", async () => {
        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("UNAUTHENTICATED", "Sign in"));
        const response = await POST(
            new Request("http://localhost", {
                method: "POST",
                body: JSON.stringify({ to: "ACCEPTED" }),
                headers: { "content-type": "application/json" },
            }),
            context,
        );
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
        expect(mocks.requireRole).toHaveBeenCalledWith(["ADMIN"]);
        expect(mocks.transitionDonation).toHaveBeenCalledWith(
            { store: {} },
            "11111111-1111-4111-8111-111111111111",
            "DECLINED",
            {
                id: "admin-1",
                email: "admin@foodlink.test",
                name: "FoodLink Admin",
                role: "ADMIN",
                status: "ACTIVE",
            },
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

    it("maps an inactive or unknown volunteer to 422", async () => {
        const serviceError = new mocks.DonationTransitionError("VOLUNTEER_NOT_ACTIVE", "Volunteer must be ACTIVE");
        mocks.transitionDonation.mockRejectedValue(serviceError);
        const response = await POST(
            new Request("http://localhost", {
                method: "POST",
                body: JSON.stringify({ to: "ASSIGNED", volunteerId: "22222222-2222-4222-8222-222222222222" }),
                headers: { "content-type": "application/json" },
            }),
            context,
        );
        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.error).toBe("VOLUNTEER_NOT_ACTIVE");
    });
});
