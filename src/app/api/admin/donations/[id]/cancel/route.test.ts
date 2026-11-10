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
    mocks.transitionDonation.mockResolvedValue({ from: "ASSIGNED", to: "CANCELLED" });
});

describe("POST /api/admin/donations/[id]/cancel", () => {
    it("requires an admin session", async () => {
        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("FORBIDDEN", "Not allowed"));
        const response = await POST(request({ reason: "Venue full" }), context);
        expect(response.status).toBe(403);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();

        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("UNAUTHENTICATED", "Sign in"));
        const unauthenticated = await POST(request({ reason: "Venue full" }), context);
        expect(unauthenticated.status).toBe(401);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("requires a non-empty reason and rejects unknown fields", async () => {
        const missing = await POST(request({}), context);
        expect(missing.status).toBe(400);

        const blank = await POST(request({ reason: "" }), context);
        expect(blank.status).toBe(400);

        const extra = await POST(request({ reason: "Venue full", donorId: "someone" }), context);
        expect(extra.status).toBe(400);

        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("cancels as the session admin with the trimmed reason", async () => {
        const response = await POST(request({ reason: "  Venue full  " }), context);
        expect(response.status).toBe(200);
        expect(mocks.requireRole).toHaveBeenCalledWith(["ADMIN"]);
        expect(mocks.transitionDonation).toHaveBeenCalledWith(
            { store: {} },
            donationId,
            "CANCELLED",
            adminActor,
            { reason: "Venue full" },
        );
    });

    it("maps service refusals to 4xx", async () => {
        mocks.transitionDonation.mockRejectedValue(new mocks.DonationTransitionError("MISSING_PAYLOAD", "A reason is required"));
        const missingPayload = await POST(request({ reason: "Venue full" }), context);
        expect(missingPayload.status).toBe(400);

        mocks.transitionDonation.mockRejectedValue(new mocks.DonationTransitionError("INVALID_TRANSITION", "Cannot transition PICKED_UP to CANCELLED"));
        const conflict = await POST(request({ reason: "Venue full" }), context);
        expect(conflict.status).toBe(409);
    });
});
