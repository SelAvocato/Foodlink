import { describe, expect, it } from "vitest";
import { accountStatusFromError } from "./login-status";

describe("accountStatusFromError", () => {
  it("maps the named inactive-account reasons", () => {
    expect(accountStatusFromError("Pending account")).toBe("pending");
    expect(accountStatusFromError("Rejected account")).toBe("rejected");
    expect(accountStatusFromError("Suspended account")).toBe("suspended");
  });

  it("ignores lockout, invalid and unknown errors", () => {
    expect(accountStatusFromError("account_locked:2026-01-01T00:00:00.000Z")).toBeNull();
    expect(accountStatusFromError("Invalid username or password")).toBeNull();
    expect(accountStatusFromError("CredentialsSignin")).toBeNull();
  });

  it("handles missing values", () => {
    expect(accountStatusFromError(null)).toBeNull();
    expect(accountStatusFromError(undefined)).toBeNull();
    expect(accountStatusFromError("")).toBeNull();
  });
});
