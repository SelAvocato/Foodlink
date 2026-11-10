import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    expireDueDonations: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
    getEnv: () => ({ CRON_SECRET: "test-cron-secret-at-least-thirty-two-characters-long" }),
}));
vi.mock("@/server/expiry/expire-due-donations", () => ({ expireDueDonations: mocks.expireDueDonations }));
vi.mock("@/server/expiry/prisma-expiry-store", () => ({ prismaExpiryStore: {}, prismaExpiryTransition: vi.fn() }));

import { POST } from "./route";

const SECRET = "test-cron-secret-at-least-thirty-two-characters-long";

function request(header?: string) {
    return new Request("http://localhost/api/cron/expire-donations", {
        method: "POST",
        headers: header === undefined ? {} : { authorization: header },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.expireDueDonations.mockResolvedValue({ expired: 2, skipped: 0, failed: 0 });
});

describe("POST /api/cron/expire-donations", () => {
    it("rejects callers without the cron secret", async () => {
        const missing = await POST(request());
        expect(missing.status).toBe(401);

        const wrong = await POST(request("Bearer wrong"));
        expect(wrong.status).toBe(401);

        expect(mocks.expireDueDonations).not.toHaveBeenCalled();
    });

    it("runs the expiry job for an authorized caller", async () => {
        const response = await POST(request(`Bearer ${SECRET}`));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ expired: 2, skipped: 0, failed: 0 });
        expect(mocks.expireDueDonations).toHaveBeenCalledWith(expect.objectContaining({
            store: {},
            transition: expect.any(Function),
        }));
    });

    it("returns 500 after processing when one donation failed", async () => {
        mocks.expireDueDonations.mockResolvedValue({ expired: 1, skipped: 0, failed: 1 });
        const response = await POST(request(`Bearer ${SECRET}`));
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ expired: 1, skipped: 0, failed: 1 });
    });

    it("returns 500 when the run throws", async () => {
        mocks.expireDueDonations.mockRejectedValue(new Error("database exploded"));
        const response = await POST(request(`Bearer ${SECRET}`));
        expect(response.status).toBe(500);
    });
});
