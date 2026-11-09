import { describe, expect, it } from "vitest";
import { newQrToken } from "./qr-token";

describe("newQrToken", () => {
  it("returns 43 base64url characters, the format donations_qr_token_format allows", () => {
    for (let i = 0; i < 50; i += 1) {
      const token = newQrToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("asks exactly for 32 bytes", () => {
    const sizes: number[] = [];

    newQrToken((size) => {
      sizes.push(size);
      return Buffer.alloc(size);
    });

    expect(sizes).toEqual([32]);
  });

  it("encodes the injected bytes deterministically", () => {
    const bytes = Buffer.alloc(32, 7);
    const injected = () => bytes;

    const first = newQrToken(injected);
    const second = newQrToken(injected);

    expect(first).toBe(bytes.toString("base64url"));
    expect(second).toBe(first);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates 1000 tokens that are all different", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => newQrToken()));

    expect(tokens.size).toBe(1000);
  });
});
