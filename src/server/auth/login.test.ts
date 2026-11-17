import { afterEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  users: { findFirst: vi.fn() },
  audit_logs: { create: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/env.server", () => ({ getEnv: () => ({ AUTH_SECRET: "test-secret" }) }));
vi.mock("@node-rs/argon2", () => ({ verify: vi.fn() }));

import { authenticateLogin } from "./login";

afterEach(() => {
  vi.clearAllMocks();
});

describe("authenticateLogin database failure logging", () => {
  it("logs a safe error summary without the login email or raw error message", async () => {
    const email = "leak@example.test";
    const error = new Error(`select failed for ${email}`);
    prismaMock.users.findFirst.mockRejectedValue(error);
    prismaMock.audit_logs.create.mockResolvedValue({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(authenticateLogin({ email, password: "Password123!" })).rejects.toMatchObject({
      category: "database_error",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [label, payload] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(label).toBe("Authentication database failure");
    expect(payload).toMatchObject({ errorName: "Error", category: "database_error" });
    expect(payload).not.toHaveProperty("error");
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain("select failed");

    spy.mockRestore();
  });
});

describe("authenticateLogin account lockout", () => {
  it("throws account_locked with the locked-until timestamp for a locked account", async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60_000);
    prismaMock.users.findFirst.mockResolvedValue({
      id: "user-1",
      email: "locked@example.test",
      full_name: "Locked User",
      role: "DONOR",
      status: "ACTIVE",
      user_credentials: {
        password_hash: "not-checked",
        failed_login_count: 5,
        locked_until: lockedUntil,
      },
    });
    prismaMock.audit_logs.create.mockResolvedValue({});

    await expect(
      authenticateLogin({ email: "locked@example.test", password: "Password123!" }),
    ).rejects.toMatchObject({
      category: "account_locked",
      message: `account_locked:${lockedUntil.toISOString()}`,
    });
  });
});
