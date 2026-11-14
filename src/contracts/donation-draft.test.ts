import { describe, expect, it } from "vitest";
import { createDraftSchema, updateDraftSchema } from "./donation-draft";

const validCreate = {
  foodCategoryCode: "COOKED_MEALS",
  foodName: "Chicken adobo",
  portions: 25,
};

describe("createDraftSchema", () => {
  it("accepts a valid draft with every optional field", () => {
    const result = createDraftSchema.safeParse({
      ...validCreate,
      description: "  Fresh from the kitchen  ",
      allergenCodes: ["PEANUTS"],
      dietaryTagCodes: ["HALAL"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.foodName).toBe("Chicken adobo");
      expect(result.data.description).toBe("Fresh from the kitchen");
      expect(result.data.allergenCodes).toEqual(["PEANUTS"]);
      expect(result.data.dietaryTagCodes).toEqual(["HALAL"]);
    }
  });

  it("trims the food name and rejects a blank one", () => {
    expect(createDraftSchema.parse({ ...validCreate, foodName: "  Pancit  " }).foodName).toBe("Pancit");
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "" }).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "   " }).success).toBe(false);
  });

  it("strips markup from the food name and the description", () => {
    const result = createDraftSchema.parse({
      ...validCreate,
      foodName: "<Chicken> adobo",
      description: "Fresh <from> the kitchen",
    });
    expect(result.foodName).toBe("Chicken adobo");
    expect(result.description).toBe("Fresh from the kitchen");
  });

  it("rejects a food name that is only markup", () => {
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "<>" }).success).toBe(false);
  });

  it("turns a description that is only markup into undefined", () => {
    const result = createDraftSchema.safeParse({ ...validCreate, description: "<>" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeUndefined();
  });

  it("keeps a line break in the description", () => {
    const result = createDraftSchema.parse({ ...validCreate, description: "Cooked at 8am\nServe warm" });
    expect(result.description).toBe("Cooked at 8am\nServe warm");
  });

  it("counts the length limit after stripping", () => {
    expect(createDraftSchema.safeParse({ ...validCreate, description: "x".repeat(1000) + "<><>" }).success).toBe(true);
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "x".repeat(160) + "<><>" }).success).toBe(true);
  });

  it("rejects a food name over 160 characters", () => {
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "x".repeat(160) }).success).toBe(true);
    expect(createDraftSchema.safeParse({ ...validCreate, foodName: "x".repeat(161) }).success).toBe(false);
  });

  it.each([0, 1.5, 100001])("rejects portions %s", (badPortions) => {
    expect(createDraftSchema.safeParse({ ...validCreate, portions: badPortions }).success).toBe(false);
  });

  it("accepts the portions bounds 1 and 100000", () => {
    expect(createDraftSchema.safeParse({ ...validCreate, portions: 1 }).success).toBe(true);
    expect(createDraftSchema.safeParse({ ...validCreate, portions: 100000 }).success).toBe(true);
  });

  it.each(["status", "donorId", "pickupStart"])("rejects the unknown key %s", (key) => {
    expect(createDraftSchema.safeParse({ ...validCreate, [key]: "x" }).success).toBe(false);
  });

  it("turns an empty description into undefined", () => {
    const result = createDraftSchema.safeParse({ ...validCreate, description: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeUndefined();
  });

  it("rejects a description over 1000 characters", () => {
    expect(createDraftSchema.safeParse({ ...validCreate, description: "x".repeat(1000) }).success).toBe(true);
    expect(createDraftSchema.safeParse({ ...validCreate, description: "x".repeat(1001) }).success).toBe(false);
  });

  it("collapses duplicate allergen and tag codes", () => {
    const result = createDraftSchema.safeParse({
      ...validCreate,
      allergenCodes: ["PEANUTS", " PEANUTS ", "PEANUTS"],
      dietaryTagCodes: ["HALAL", "HALAL"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allergenCodes).toEqual(["PEANUTS"]);
      expect(result.data.dietaryTagCodes).toEqual(["HALAL"]);
    }
  });

  it("rejects more than 20 codes and codes over 40 characters", () => {
    const many = Array.from({ length: 21 }, (_, index) => `ALLERGEN_${index}`);
    expect(createDraftSchema.safeParse({ ...validCreate, allergenCodes: many }).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...validCreate, allergenCodes: ["x".repeat(41)] }).success).toBe(false);
    expect(createDraftSchema.safeParse({ ...validCreate, dietaryTagCodes: ["x".repeat(41)] }).success).toBe(false);
  });
});

describe("updateDraftSchema", () => {
  it("accepts a single-field update and passes other fields through", () => {
    const single = updateDraftSchema.safeParse({ foodName: "  Pancit  " });
    expect(single.success).toBe(true);
    if (single.success) expect(single.data.foodName).toBe("Pancit");

    const full = updateDraftSchema.safeParse({
      foodCategoryCode: "COOKED_MEALS",
      foodName: "Pancit",
      portions: 10,
      description: "Updated",
      allergenCodes: [],
      dietaryTagCodes: ["HALAL"],
    });
    expect(full.success).toBe(true);
    if (full.success) expect(full.data.dietaryTagCodes).toEqual(["HALAL"]);
  });

  it("rejects an empty update with a clear message", () => {
    const result = updateDraftSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Send at least one field to update");
  });

  it.each(["status", "donorId", "pickupStart"])("rejects the unknown key %s", (key) => {
    expect(updateDraftSchema.safeParse({ [key]: "x" }).success).toBe(false);
  });

  it("turns an empty description into null so it clears the column", () => {
    const result = updateDraftSchema.safeParse({ description: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeNull();
  });

  it("strips markup from the food name and the description", () => {
    const result = updateDraftSchema.parse({ foodName: "  <Pancit>  ", description: "Updated <today>" });
    expect(result.foodName).toBe("Pancit");
    expect(result.description).toBe("Updated today");
  });

  it("rejects a food name that is only markup", () => {
    expect(updateDraftSchema.safeParse({ foodName: "<>" }).success).toBe(false);
  });

  it("turns a description that is only markup into null", () => {
    const result = updateDraftSchema.safeParse({ description: "<>" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeNull();
  });

  it("keeps a line break in the description", () => {
    expect(updateDraftSchema.parse({ description: "Cooked at 8am\nServe warm" }).description).toBe(
      "Cooked at 8am\nServe warm",
    );
  });

  it("counts the length limit after stripping", () => {
    expect(updateDraftSchema.safeParse({ description: "x".repeat(1000) + "<><>" }).success).toBe(true);
    expect(updateDraftSchema.safeParse({ foodName: "x".repeat(160) + "<><>" }).success).toBe(true);
  });

  it("rejects invalid values on the fields it does accept", () => {
    expect(updateDraftSchema.safeParse({ portions: 0 }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ foodName: "" }).success).toBe(false);
    expect(updateDraftSchema.safeParse({ description: "x".repeat(1001) }).success).toBe(false);
  });
});
