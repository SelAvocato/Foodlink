import { describe, expect, it } from "vitest";
import { screeningQueueQuerySchema } from "./screening-queue";

describe("screeningQueueQuerySchema", () => {
  it("defaults to a limit of 20 when none is given", () => {
    const result = screeningQueueQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ limit: 20 });
  });

  it("coerces a query-string limit to an integer", () => {
    const result = screeningQueueQuerySchema.safeParse({ limit: "10" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ limit: 10 });
  });

  it.each([1, 100, 50])("accepts the boundary limit %i", (limit) => {
    expect(screeningQueueQuerySchema.safeParse({ limit }).success).toBe(true);
  });

  it.each([
    ["below the minimum", "0"],
    ["above the maximum", "101"],
    ["a fraction", "1.5"],
    ["not a number", "abc"],
  ])("rejects a limit %s", (_label, limit) => {
    expect(screeningQueueQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it("rejects unknown query fields", () => {
    expect(screeningQueueQuerySchema.safeParse({ status: "DRAFT" }).success).toBe(false);
    expect(screeningQueueQuerySchema.safeParse({ limit: 10, foo: "1" }).success).toBe(false);
  });
});
