import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));
vi.mock("@/lib/env.server", () => ({ getEnv: () => ({ AUTH_SECRET: "test-secret" }) }));

import { proxy } from "./proxy";

function request(path: string) {
    return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => vi.clearAllMocks());

describe("proxy", () => {
    it("leaves the public admin login route open", async () => {
        const response = await proxy({ nextUrl: new URL("http://localhost:3000/admin/login"), url: "http://localhost:3000/admin/login" } as never);
        expect(response.status).toBe(200);
        expect(mocks.getToken).not.toHaveBeenCalled();
    });

    it("returns JSON 401 for unauthenticated API requests", async () => {
        mocks.getToken.mockResolvedValue(null);
        const response = await proxy({ nextUrl: new URL("http://localhost:3000/api/admin/users"), url: "http://localhost:3000/api/admin/users" } as never);
        expect(response.status).toBe(401);
    });

    it("allows a donor path only for an active donor token", async () => {
        mocks.getToken.mockResolvedValue({ id: "donor-1", role: "DONOR", status: "ACTIVE" });
        const response = await proxy({ nextUrl: new URL("http://localhost:3000/donor/dashboard"), url: "http://localhost:3000/donor/dashboard" } as never);
        expect(response.status).toBe(200);
        expect(request("/donor/dashboard")).toBeTruthy();
    });

    it("returns JSON 403 for an active user with the wrong API role", async () => {
        mocks.getToken.mockResolvedValue({ id: "donor-1", role: "DONOR", status: "ACTIVE" });
        const response = await proxy({ nextUrl: new URL("http://localhost:3000/api/admin/users"), url: "http://localhost:3000/api/admin/users" } as never);
        expect(response.status).toBe(403);
    });
});
