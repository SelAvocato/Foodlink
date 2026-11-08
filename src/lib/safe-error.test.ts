import { describe, expect, it } from "vitest";
import { safeErrorSummary } from "./safe-error";

const FAKE_KEY = "food/33333333-3333-4333-8333-333333333333.jpg";
const FAKE_SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";

class StorageCleanupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageCleanupError";
  }
}

describe("safeErrorSummary", () => {
  it("keeps the name of an Error subclass", () => {
    expect(safeErrorSummary(new StorageCleanupError("cleanup failed"))).toEqual({
      errorName: "StorageCleanupError",
    });
  });

  it("keeps the name of a plain Error", () => {
    expect(safeErrorSummary(new Error("cleanup failed"))).toEqual({ errorName: "Error" });
  });

  it.each(["proofs/abc.jpg", "bad name", `leak ${FAKE_KEY}`])(
    "answers UnknownError for an Error name that is not a token (%j)",
    (name) => {
      const error = new Error(`cleanup failed at ${FAKE_SIGNED_URL}`);
      error.name = name;
      const summary = safeErrorSummary(error);

      expect(summary).toEqual({ errorName: "UnknownError" });
      const result = JSON.stringify(summary);
      expect(result).not.toContain(FAKE_KEY);
      expect(result).not.toContain(FAKE_SIGNED_URL);
      expect(result).not.toContain("cleanup failed");
    },
  );

  it("answers UnknownError for a thrown string", () => {
    expect(safeErrorSummary("cleanup failed")).toEqual({ errorName: "UnknownError" });
  });

  it("answers UnknownError for null", () => {
    expect(safeErrorSummary(null)).toEqual({ errorName: "UnknownError" });
  });

  it("includes a string code, as Prisma uses (P2002)", () => {
    expect(safeErrorSummary(Object.assign(new Error("duplicate"), { code: "P2002" }))).toEqual({
      errorName: "Error",
      errorCode: "P2002",
    });
  });

  it.each(["P2002", "ENOENT"])("keeps a short identifier-like code (%s)", (code) => {
    expect(safeErrorSummary(Object.assign(new Error("boom"), { code }))).toEqual({
      errorName: "Error",
      errorCode: code,
    });
  });

  it("keeps a valid string code on a non-Error object and reports UnknownError", () => {
    const summary = safeErrorSummary({
      code: "P2002",
      message: `duplicate for ${FAKE_KEY} at ${FAKE_SIGNED_URL}`,
    });

    expect(summary).toEqual({ errorName: "UnknownError", errorCode: "P2002" });
    const result = JSON.stringify(summary);
    expect(result).not.toContain(FAKE_KEY);
    expect(result).not.toContain(FAKE_SIGNED_URL);
  });

  it("omits a message-like, spaced or over-long code", () => {
    const codes = [
      `remove failed for ${FAKE_KEY} at ${FAKE_SIGNED_URL}`,
      "storage object not found",
      "A".repeat(65),
    ];

    for (const code of codes) {
      const summary = safeErrorSummary({ code, message: "boom" });

      expect(summary).toEqual({ errorName: "UnknownError" });
      expect(Object.keys(summary)).toEqual(["errorName"]);
      const result = JSON.stringify(summary);
      expect(result).not.toContain(FAKE_KEY);
      expect(result).not.toContain(FAKE_SIGNED_URL);
      expect(result).not.toContain(code);
    }
  });

  it("omits a numeric code", () => {
    const summary = safeErrorSummary({ code: 500, message: "server error" });
    expect(summary).toEqual({ errorName: "UnknownError" });
    expect(Object.keys(summary)).toEqual(["errorName"]);
  });

  it("never carries the message, a key or a signed URL", () => {
    const message = `remove failed for ${FAKE_KEY} at ${FAKE_SIGNED_URL}`;
    const result = JSON.stringify(safeErrorSummary(new Error(message)));

    expect(result).not.toContain(message);
    expect(result).not.toContain(FAKE_KEY);
    expect(result).not.toContain(FAKE_SIGNED_URL);
    expect(result).not.toContain("remove failed");
    expect(result).toBe(JSON.stringify({ errorName: "Error" }));
  });
});
