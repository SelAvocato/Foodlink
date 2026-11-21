import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminAcceptedDonationsQuerySchema } from "./admin-accepted-donations";

/** The route parses the query string, so every value arrives as text. */
function parse(query: Record<string, string>) {
  return adminAcceptedDonationsQuerySchema.safeParse(query);
}

function fieldErrors(result: ReturnType<typeof parse>, field: "limit"): string[] {
  return result.success ? [] : (z.flattenError(result.error).fieldErrors[field] ?? []);
}

describe("adminAcceptedDonationsQuerySchema", () => {
  it("defaults the limit to 50", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(50);
  });

  it.each(["1", "100"])("accepts the limit boundary %s", (limit) => {
    const result = parse({ limit });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(Number(limit));
  });

  it.each(["0", "101", "1.5", "abc"])("rejects the limit %s", (limit) => {
    const result = parse({ limit });

    expect(result.success).toBe(false);
    expect(fieldErrors(result, "limit").length).toBeGreaterThan(0);
  });

  it("rejects unknown query fields", () => {
    const result = parse({ status: "ACCEPTED" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(z.flattenError(result.error).formErrors.join(" ")).toContain("status");
    }
  });
});
