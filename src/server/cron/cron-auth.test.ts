import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.server", () => ({
    getEnv: () => ({ CRON_SECRET: "test-cron-secret-at-least-thirty-two-characters-long" }),
}));
import { isCronAuthorized } from "./cron-auth";

const SECRET = "test-cron-secret-at-least-thirty-two-characters-long";

function request(header?: string) {
    return new Request("http://localhost/api/cron/expire-donations", {
        method: "POST",
        headers: header === undefined ? {} : { authorization: header },
    });
}

describe("isCronAuthorized", () => {
    it("accepts the exact bearer secret", () => {
        expect(isCronAuthorized(request(`Bearer ${SECRET}`))).toBe(true);
    });

    it("rejects a missing header", () => {
        expect(isCronAuthorized(request())).toBe(false);
    });

    it("rejects a wrong secret of the same length", () => {
        const wrong = "x".repeat(SECRET.length);
        expect(isCronAuthorized(request(`Bearer ${wrong}`))).toBe(false);
    });

    it("rejects a secret of the wrong length", () => {
        expect(isCronAuthorized(request("Bearer short"))).toBe(false);
    });

    it("rejects a non-Bearer scheme", () => {
        expect(isCronAuthorized(request(`Basic ${SECRET}`))).toBe(false);
    });
});
