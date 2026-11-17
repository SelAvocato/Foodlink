import { describe, expect, it } from "vitest";
import type { FoodOptionsStore } from "./food-options";
import { getFoodOptions } from "./food-options";

const USER_ID = "user-1";

class FakeFoodOptionsStore implements FoodOptionsStore {
  donorType: unknown = null;
  categories: unknown[] = [];
  allergens: unknown[] = [];
  dietaryTags: unknown[] = [];
  calls: string[] = [];

  async findDonorType(userId: string): Promise<unknown> {
    this.calls.push(`findDonorType:${userId}`);
    return this.donorType;
  }

  async listCategories(): Promise<unknown[]> {
    this.calls.push("listCategories");
    return this.categories;
  }

  async listAllergens(): Promise<unknown[]> {
    this.calls.push("listAllergens");
    return this.allergens;
  }

  async listDietaryTags(): Promise<unknown[]> {
    this.calls.push("listDietaryTags");
    return this.dietaryTags;
  }
}

/** The five seeded-style categories, in seed order. */
function seededCategories(): unknown[] {
  return [
    {
      code: "COOKED_MEALS",
      name: "Cooked Meals",
      allowed_for_individuals: false,
      requires_prepared_time: true,
      requires_storage_info: true,
    },
    {
      code: "BAKERY",
      name: "Bakery",
      allowed_for_individuals: false,
      requires_prepared_time: true,
      requires_storage_info: false,
    },
    {
      code: "FRESH_PRODUCE",
      name: "Whole Fresh Produce",
      allowed_for_individuals: true,
      requires_prepared_time: false,
      requires_storage_info: false,
    },
    {
      code: "PACKAGED_FOOD",
      name: "Sealed Packaged Food",
      allowed_for_individuals: true,
      requires_prepared_time: false,
      requires_storage_info: false,
    },
    {
      code: "BEVERAGES",
      name: "Sealed Beverages",
      allowed_for_individuals: true,
      requires_prepared_time: false,
      requires_storage_info: false,
    },
  ];
}

function seededAllergens(): unknown[] {
  return [
    { code: "PEANUTS", name: "Peanuts" },
    { code: "MILK", name: "Milk" },
  ];
}

function seededDietaryTags(): unknown[] {
  return [
    { code: "HALAL", name: "Halal" },
    { code: "VEGETARIAN", name: "Vegetarian" },
  ];
}

/** A store ready for a complete answer: a donor type and every lookup list. */
function loadedStore(donorType: unknown) {
  const store = new FakeFoodOptionsStore();
  store.donorType = donorType;
  store.categories = seededCategories();
  store.allergens = seededAllergens();
  store.dietaryTags = seededDietaryTags();
  return store;
}

describe("getFoodOptions", () => {
  it("returns every seeded category to an ESTABLISHMENT donor and sends the session user id", async () => {
    const store = loadedStore({ donor_type: "ESTABLISHMENT" });

    const result = await getFoodOptions({ store }, { userId: USER_ID });

    expect(store.calls).toEqual([
      `findDonorType:${USER_ID}`,
      "listCategories",
      "listAllergens",
      "listDietaryTags",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.categories.map((category) => category.code)).toEqual([
        "COOKED_MEALS",
        "BAKERY",
        "FRESH_PRODUCE",
        "PACKAGED_FOOD",
        "BEVERAGES",
      ]);
    }
  });

  it("returns only the categories allowed for individuals to an INDIVIDUAL donor", async () => {
    const store = loadedStore({ donor_type: "INDIVIDUAL" });

    const result = await getFoodOptions({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.categories.map((category) => category.code)).toEqual([
        "FRESH_PRODUCE",
        "PACKAGED_FOOD",
        "BEVERAGES",
      ]);
    }
  });

  it("returns every category when the donor type column is null", async () => {
    const store = loadedStore({ donor_type: null });

    const result = await getFoodOptions({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.categories).toHaveLength(5);
    }
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("answers NOT_FOUND when findDonorType returns %s, without reading the lists", async (
    _label,
    value,
  ) => {
    const store = new FakeFoodOptionsStore();
    store.donorType = value;

    expect(await getFoodOptions({ store }, { userId: USER_ID })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(store.calls).toEqual([`findDonorType:${USER_ID}`]);
  });

  it("keeps the order the store returns", async () => {
    const store = loadedStore({ donor_type: "ESTABLISHMENT" });
    store.categories = [
      {
        code: "BEVERAGES",
        name: "Sealed Beverages",
        allowed_for_individuals: true,
        requires_prepared_time: false,
        requires_storage_info: false,
      },
      {
        code: "COOKED_MEALS",
        name: "Cooked Meals",
        allowed_for_individuals: false,
        requires_prepared_time: true,
        requires_storage_info: true,
      },
      {
        code: "BAKERY",
        name: "Bakery",
        allowed_for_individuals: false,
        requires_prepared_time: true,
        requires_storage_info: false,
      },
    ];

    const result = await getFoodOptions({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.options.categories.map((category) => category.code)).toEqual([
        "BEVERAGES",
        "COOKED_MEALS",
        "BAKERY",
      ]);
    }
  });

  it("answers with exactly the documented keys and nothing else", async () => {
    const store = loadedStore({ donor_type: "ESTABLISHMENT" });

    const result = await getFoodOptions({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.options).sort()).toEqual(["allergens", "categories", "dietaryTags"]);
      expect(Object.keys(result.options.categories[0]).sort()).toEqual([
        "code",
        "name",
        "requiresPreparedTime",
        "requiresStorageInfo",
      ]);
      expect(Object.keys(result.options.allergens[0]).sort()).toEqual(["code", "name"]);
      expect(Object.keys(result.options.dietaryTags[0]).sort()).toEqual(["code", "name"]);
      // No id and no is_active anywhere in the payload.
      const payload = JSON.stringify(result.options);
      expect(payload).not.toContain("is_active");
      expect(payload).not.toContain("allowed_for_individuals");
      expect(result.options.categories[0]).toEqual({
        code: "COOKED_MEALS",
        name: "Cooked Meals",
        requiresPreparedTime: true,
        requiresStorageInfo: true,
      });
    }
  });

  it("throws when a category row has the wrong type for a flag", async () => {
    const store = loadedStore({ donor_type: "ESTABLISHMENT" });
    store.categories = [
      {
        code: "COOKED_MEALS",
        name: "Cooked Meals",
        allowed_for_individuals: false,
        requires_prepared_time: "yes",
        requires_storage_info: false,
      },
    ];

    await expect(getFoodOptions({ store }, { userId: USER_ID })).rejects.toThrow(
      "A food category row has an unexpected shape.",
    );
  });

  it("throws when a row carries a column the SQL must never return", async () => {
    const store = loadedStore({ donor_type: "ESTABLISHMENT" });
    // is_active is filtered in SQL and never selected; a strict schema rejects it,
    // so it can never leak into a response even if a future SELECT adds it.
    store.categories = [
      {
        code: "COOKED_MEALS",
        name: "Cooked Meals",
        allowed_for_individuals: false,
        requires_prepared_time: true,
        requires_storage_info: true,
        is_active: true,
      },
    ];

    await expect(getFoodOptions({ store }, { userId: USER_ID })).rejects.toThrow(
      "A food category row has an unexpected shape.",
    );
  });

  it("throws when the donor type row is not a known donor type", async () => {
    const store = loadedStore({ donor_type: "SOMEBODY" });

    await expect(getFoodOptions({ store }, { userId: USER_ID })).rejects.toThrow(
      "The donor type row has an unexpected shape.",
    );
  });
});
