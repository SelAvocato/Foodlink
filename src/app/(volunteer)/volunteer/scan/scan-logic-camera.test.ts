import { describe, expect, it } from "vitest";
import { coverCrop, tokenFromScannedText } from "./scan-logic";

describe("tokenFromScannedText", () => {
  it("reads the token from a label URL", () => {
    expect(tokenFromScannedText("https://foodlink.example/volunteer/scan#abc123")).toBe("abc123");
  });

  it("ignores the origin and the path", () => {
    expect(tokenFromScannedText("http://localhost:3000/volunteer/scan#tok")).toBe("tok");
    expect(tokenFromScannedText("https://other.example/anything#tok")).toBe("tok");
  });

  it("trims spaces around the scanned text", () => {
    expect(tokenFromScannedText("  https://foodlink.example/volunteer/scan#abc123  ")).toBe(
      "abc123",
    );
  });

  it("returns null when there is no fragment or it is empty", () => {
    expect(tokenFromScannedText("https://foodlink.example/volunteer/scan")).toBeNull();
    expect(tokenFromScannedText("https://foodlink.example/volunteer/scan#")).toBeNull();
  });

  it("returns null for text that is not a URL", () => {
    expect(tokenFromScannedText("")).toBeNull();
    expect(tokenFromScannedText("hello world")).toBeNull();
    expect(tokenFromScannedText("abc123")).toBeNull();
  });
});

describe("coverCrop", () => {
  it("cuts the sides of a wide video shown in a square box", () => {
    expect(coverCrop(1920, 1080, 400, 400)).toEqual({ sx: 420, sy: 0, sw: 1080, sh: 1080 });
  });

  it("cuts the top and bottom of a tall video shown in a square box", () => {
    expect(coverCrop(1080, 1920, 400, 400)).toEqual({ sx: 0, sy: 420, sw: 1080, sh: 1080 });
  });

  it("keeps the whole frame when the ratios match", () => {
    expect(coverCrop(800, 400, 400, 200)).toEqual({ sx: 0, sy: 0, sw: 800, sh: 400 });
  });

  it("gives the whole frame when a size is 0 or not finite", () => {
    const whole = { sx: 0, sy: 0, sw: 1920, sh: 1080 };
    expect(coverCrop(1920, 1080, 0, 353)).toEqual(whole);
    expect(coverCrop(1920, 1080, Number.NaN, 353)).toEqual(whole);
  });
});
