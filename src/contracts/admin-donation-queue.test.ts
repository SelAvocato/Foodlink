import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adminDonationQueueQuerySchema } from "./admin-donation-queue";

/** The route parses the query string, so every value arrives as text. */
function parse(query: Record<string, string>) {
  return adminDonationQueueQuerySchema.safeParse(query);
}

function fieldErrors(result: ReturnType<typeof parse>, field: "limit" | "foodCategoryId"): string[] {
  return result.success ? [] : (z.flattenError(result.error).fieldErrors[field] ?? []);
}

describe("adminDonationQueueQuerySchema", () => {
  it("defaults the limit to 50 and leaves the category filter unset", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(result.data.foodCategoryId).toBeUndefined();
    }
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

  it("accepts foodCategoryId 3", () => {
    const result = parse({ foodCategoryId: "3" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.foodCategoryId).toBe(3);
  });

  it.each(["0", "-1", "1.5", "40000"])("rejects the foodCategoryId %s", (foodCategoryId) => {
    const result = parse({ foodCategoryId });

    expect(result.success).toBe(false);
    expect(fieldErrors(result, "foodCategoryId").length).toBeGreaterThan(0);
  });

  it("rejects unknown query fields", () => {
    const result = parse({ status: "POSTED" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(z.flattenError(result.error).formErrors.join(" ")).toContain("status");
    }
  });
});
