import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    runCleanup: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
    getEnv: () => ({ CRON_SECRET: "test-cron-secret-at-least-thirty-two-characters-long" }),
}));
vi.mock("@/server/cleanup/run-cleanup", () => ({ runCleanup: mocks.runCleanup }));
vi.mock("@/server/cleanup/prisma-cleanup-store", () => ({ prismaCleanupStore: {} }));

import { POST } from "./route";

const SECRET = "test-cron-secret-at-least-thirty-two-characters-long";

function request(header?: string) {
    return new Request("http://localhost/api/cron/cleanup", {
        method: "POST",
        headers: header === undefined ? {} : { authorization: header },
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.runCleanup.mockResolvedValue({ otpDays: 1, notificationDays: 90 });
});

describe("POST /api/cron/cleanup", () => {
    it("rejects callers without the cron secret", async () => {
        const missing = await POST(request());
        expect(missing.status).toBe(401);

        const wrong = await POST(request("Bearer wrong"));
        expect(wrong.status).toBe(401);

        expect(mocks.runCleanup).not.toHaveBeenCalled();
    });

    it("runs the cleanup for an authorized caller", async () => {
        const response = await POST(request(`Bearer ${SECRET}`));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ otpDays: 1, notificationDays: 90 });
        expect(mocks.runCleanup).toHaveBeenCalledWith({ store: {} });
    });

    it("returns 500 when the run throws", async () => {
        mocks.runCleanup.mockRejectedValue(new Error("database exploded"));
        const response = await POST(request(`Bearer ${SECRET}`));
        expect(response.status).toBe(500);
    });
});
