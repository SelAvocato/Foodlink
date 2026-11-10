import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runCleanup, type CleanupStore } from "./run-cleanup";

describe("runCleanup", () => {
  it("runs the cleanup procedure with the default retention values", async () => {
    const calls: Array<[number, number]> = [];
    const store: CleanupStore = {
      run: async (otpDays, notificationDays) => { calls.push([otpDays, notificationDays]); },
    };

    const result = await runCleanup({ store });

    expect(calls).toEqual([[1, 90]]);
    expect(result).toEqual({ otpDays: 1, notificationDays: 90 });
  });

  it("passes explicit retention values through to the store", async () => {
    const calls: Array<[number, number]> = [];
    const store: CleanupStore = {
      run: async (otpDays, notificationDays) => { calls.push([otpDays, notificationDays]); },
    };

    await runCleanup({ store }, { otpDays: 2, notificationDays: 60 });

    expect(calls).toEqual([[2, 60]]);
  });
});
