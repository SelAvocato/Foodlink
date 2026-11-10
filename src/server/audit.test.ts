import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn(async () => ({})) }));
vi.mock("@/server/db", () => ({ prisma: { audit_logs: { create: mocks.create } } }));
import { writeAuditLog, type AuditClient } from "./audit";

describe("writeAuditLog", () => {
  beforeEach(() => {
    mocks.create.mockClear();
  });

  it("writes through the global client when no client is passed", async () => {
    await writeAuditLog({
      action: "AUTH_LOGIN_FAILURE",
      targetType: "AUTH_LOGIN",
      actorUserId: "user-1",
      targetId: "user-1",
      details: { category: "invalid_password" },
    });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        actor_user_id: "user-1",
        action: "AUTH_LOGIN_FAILURE",
        target_type: "AUTH_LOGIN",
        target_id: "user-1",
        details: { category: "invalid_password" },
      },
    });
  });

  it("defaults optional fields to null and an empty details object", async () => {
    await writeAuditLog({ action: "DONATION_TRANSITION", targetType: "DONATION" });

    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        actor_user_id: null,
        action: "DONATION_TRANSITION",
        target_type: "DONATION",
        target_id: null,
        details: {},
      },
    });
  });

  it("writes through the passed transaction client instead of the global client", async () => {
    const txCreate = vi.fn(async () => ({}));
    const tx: AuditClient = { audit_logs: { create: txCreate } };

    await writeAuditLog({ action: "DONATION_TRANSITION", targetType: "DONATION", targetId: "donation-1" }, tx);

    expect(txCreate).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
