import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("creates an Argon2id hash that is not the password", async () => {
    const hash = await hashPassword("Abcdef1!");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(hash).not.toContain("Abcdef1!");
  });
  it("uses a new salt every time", async () => {
    expect(await hashPassword("Abcdef1!")).not.toBe(await hashPassword("Abcdef1!"));
  });
  it("accepts the right password, including non-ASCII characters", async () => {
    expect(await verifyPassword(await hashPassword("Abcdef1!"), "Abcdef1!")).toBe(true);
    expect(await verifyPassword(await hashPassword("Pässwörd1!ñ"), "Pässwörd1!ñ")).toBe(true);
  });
  it("rejects a wrong password", async () => {
    expect(await verifyPassword(await hashPassword("Abcdef1!"), "Abcdef1?")).toBe(false);
  });
  it("returns false for an empty or malformed stored hash", async () => {
    expect(await verifyPassword("", "Abcdef1!")).toBe(false);
    expect(await verifyPassword("not-a-hash", "Abcdef1!")).toBe(false);
  });
});