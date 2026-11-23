import { describe, expect, it } from "vitest";
import { tokenFromScannedText } from "./scan-logic";

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
