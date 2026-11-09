import { describe, expect, it } from "vitest";
import { providerResultSchema } from "./food-screening";

const VALID = { verdict: "PASS", confidence: 0.99, signs: [] };

describe("providerResultSchema", () => {
  it("accepts a complete provider reply", () => {
    const parsed = providerResultSchema.safeParse(VALID);

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(VALID);
    }
  });

  it.each(["PASS", "FLAG", "REVIEW"])("accepts the %s verdict", (verdict) => {
    expect(providerResultSchema.safeParse({ ...VALID, verdict }).success).toBe(true);
  });

  it("accepts the confidence boundaries 0 and 1", () => {
    expect(providerResultSchema.safeParse({ ...VALID, confidence: 0 }).success).toBe(true);
    expect(providerResultSchema.safeParse({ ...VALID, confidence: 1 }).success).toBe(true);
  });

  it("accepts up to 20 signs", () => {
    const signs = Array.from({ length: 20 }, (_value, index) => `sign ${index}`);

    expect(providerResultSchema.safeParse({ ...VALID, signs }).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ["an unknown verdict", { ...VALID, verdict: "MAYBE" }],
    ["confidence below 0", { ...VALID, confidence: -0.01 }],
    ["confidence above 1", { ...VALID, confidence: 1.01 }],
    ["a confidence that is not a number", { ...VALID, confidence: "0.9" }],
    ["signs that are not an array", { ...VALID, signs: "mold" }],
    ["a sign that is not a string", { ...VALID, signs: ["mold", 7] }],
    ["more than 20 signs", { ...VALID, signs: Array.from({ length: 21 }, () => "sign") }],
    ["an extra field", { ...VALID, note: "extra" }],
    ["a missing verdict", { confidence: 0.99, signs: [] }],
    ["a missing confidence", { verdict: "PASS", signs: [] }],
    ["missing signs", { verdict: "PASS", confidence: 0.99 }],
    ["a reply that is not an object", "PASS"],
    ["null", null],
  ])("rejects %s", (_label, value) => {
    expect(providerResultSchema.safeParse(value).success).toBe(false);
  });
});
