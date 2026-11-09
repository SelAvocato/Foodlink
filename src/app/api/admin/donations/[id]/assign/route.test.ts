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
const volunteerId = "22222222-2222-4222-8222-222222222222";
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
    mocks.transitionDonation.mockResolvedValue({ from: "ACCEPTED", to: "ASSIGNED" });
});

describe("POST /api/admin/donations/[id]/assign", () => {
    it("requires an admin session", async () => {
        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("FORBIDDEN", "Not allowed"));
        const response = await POST(request({ volunteerId }), context);
        expect(response.status).toBe(403);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();

        mocks.requireRole.mockRejectedValue(new mocks.AuthorizationError("UNAUTHENTICATED", "Sign in"));
        const unauthenticated = await POST(request({ volunteerId }), context);
        expect(unauthenticated.status).toBe(401);
        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("requires a uuid volunteerId and rejects unknown fields", async () => {
        const missing = await POST(request({}), context);
        expect(missing.status).toBe(400);

        const notUuid = await POST(request({ volunteerId: "volunteer-1" }), context);
        expect(notUuid.status).toBe(400);

        const extra = await POST(request({ volunteerId, actorId: "someone-else" }), context);
        expect(extra.status).toBe(400);

        expect(mocks.transitionDonation).not.toHaveBeenCalled();
    });

    it("assigns the given volunteer as the session admin", async () => {
        const response = await POST(request({ volunteerId }), context);
        expect(response.status).toBe(200);
        expect(mocks.requireRole).toHaveBeenCalledWith(["ADMIN"]);
        expect(mocks.transitionDonation).toHaveBeenCalledWith(
            { store: {} },
            donationId,
            "ASSIGNED",
            adminActor,
            { volunteerId },
        );
    });

    it("returns 400 when the volunteer is not active", async () => {
        mocks.transitionDonation.mockRejectedValue(new mocks.DonationTransitionError("MISSING_PAYLOAD", "Volunteer must be ACTIVE"));
        const response = await POST(request({ volunteerId }), context);
        expect(response.status).toBe(400);
    });

    it("returns 409 when the donation is not assignable", async () => {
        mocks.transitionDonation.mockRejectedValue(new mocks.DonationTransitionError("INVALID_TRANSITION", "Cannot transition POSTED to ASSIGNED"));
        const response = await POST(request({ volunteerId }), context);
        expect(response.status).toBe(409);
    });
});
