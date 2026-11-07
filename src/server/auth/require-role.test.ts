import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getServerSession: vi.fn(),
    findFirst: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/server/db", () => ({ prisma: { users: { findFirst: mocks.findFirst } } }));

import { AuthorizationError, requireRole } from "./require-role";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
        user: { id: "user-1", role: "ADMIN", status: "ACTIVE" },
    });
    mocks.findFirst.mockResolvedValue({
        id: "user-1",
        email: "admin@foodlink.test",
        full_name: "FoodLink Admin",
        role: "ADMIN",
        status: "ACTIVE",
    });
});

describe("requireRole", () => {
    it("re-checks the current database status and returns the database actor", async () => {
        await expect(requireRole(["ADMIN"])).resolves.toEqual({
            id: "user-1",
            email: "admin@foodlink.test",
            name: "FoodLink Admin",
            role: "ADMIN",
            status: "ACTIVE",
        });
        expect(mocks.findFirst).toHaveBeenCalledWith({
            where: { id: "user-1", deleted_at: null },
            select: { id: true, email: true, full_name: true, role: true, status: true },
        });
    });

    it("rejects a suspended account even when its JWT says ACTIVE", async () => {
        mocks.findFirst.mockResolvedValue({
            id: "user-1",
            email: "admin@foodlink.test",
            full_name: "FoodLink Admin",
            role: "ADMIN",
            status: "SUSPENDED",
        });
        await expect(requireRole(["ADMIN"])).rejects.toMatchObject({
            code: "INACTIVE_ACCOUNT",
        });
    });

    it("rejects an unauthenticated request", async () => {
        mocks.getServerSession.mockResolvedValue(null);
        await expect(requireRole(["ADMIN"])).rejects.toBeInstanceOf(AuthorizationError);
    });

    it("rejects a valid active user with the wrong role", async () => {
        mocks.findFirst.mockResolvedValue({
            id: "user-1",
            email: "donor@foodlink.test",
            full_name: "Donor",
            role: "DONOR",
            status: "ACTIVE",
        });
        await expect(requireRole(["ADMIN"])).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
});
