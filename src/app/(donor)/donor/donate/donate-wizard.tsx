"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { ChecklistStep } from "./checklist-step";
import { DonateGuide } from "./donate-guide";
import { PhotoStep, type FoodCategoryOption } from "./photo-step";

type Step = "guide" | "photo" | "checklist";

type OptionsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: FoodCategoryOption[] };

const foodOptionsSchema = z.strictObject({
  categories: z.array(
    z.strictObject({
      code: z.string(),
      name: z.string(),
      requiresPreparedTime: z.boolean(),
      requiresStorageInfo: z.boolean(),
    }),
  ),
  allergens: z.array(z.strictObject({ code: z.string(), name: z.string() })),
  dietaryTags: z.array(z.strictObject({ code: z.string(), name: z.string() })),
});

// Loose on purpose: only donorType is read, the rest of the profile rides along unexamined.
const profileSchema = z.object({
  profile: z.object({ donorType: z.string().nullable() }),
});

function donorLabelFor(donorType: string | null): string {
  if (donorType === "ESTABLISHMENT") return "Establishment donor";
  if (donorType === "INDIVIDUAL") return "Individual donor";
  return "Donor";
}

export function DonateWizard() {
  const [step, setStep] = useState<Step>("guide");
  const [donorLabel, setDonorLabel] = useState("Donor");
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [passedCategory, setPassedCategory] = useState<FoodCategoryOption | null>(null);

  // Fetching and applying are separate: the effect only passes the apply
  // callbacks in .then, so it never calls setState synchronously
  // (react-hooks/set-state-in-effect).
  const fetchFoodOptions = useCallback(async (): Promise<FoodCategoryOption[] | null> => {
    try {
      const response = await fetch("/api/donor/food-options");
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const parsed = foodOptionsSchema.safeParse(body);
      return parsed.success ? parsed.data.categories : null;
    } catch {
      return null;
    }
  }, []);

  const applyFoodOptions = useCallback((categories: FoodCategoryOption[] | null) => {
    setOptions(
      categories === null ? { status: "error" } : { status: "ready", categories },
    );
  }, []);

  // A failed profile load keeps the neutral "Donor" label; only the label cares.
  const fetchDonorLabel = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch("/api/donor/profile");
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const parsed = profileSchema.safeParse(body);
      return parsed.success ? donorLabelFor(parsed.data.profile.donorType) : null;
    } catch {
      return null;
    }
  }, []);

  const applyDonorLabel = useCallback((label: string | null) => {
    if (label !== null) setDonorLabel(label);
  }, []);

  useEffect(() => {
    void fetchFoodOptions().then(applyFoodOptions);
    void fetchDonorLabel().then(applyDonorLabel);
  }, [fetchFoodOptions, applyFoodOptions, fetchDonorLabel, applyDonorLabel]);

  function retryCategories() {
    setOptions({ status: "loading" });
    void fetchFoodOptions().then(applyFoodOptions);
  }

  function handleStart() {
    setStep("photo");
    window.scrollTo({ top: 0 });
  }

  function handlePassed(category: FoodCategoryOption) {
    setPassedCategory(category);
    setStep("checklist");
    window.scrollTo({ top: 0 });
  }

  if (step === "checklist" && passedCategory !== null) {
    return (
      <ChecklistStep
        categoryName={passedCategory.name}
        requiresPreparedTime={passedCategory.requiresPreparedTime}
        requiresStorageInfo={passedCategory.requiresStorageInfo}
      />
    );
  }

  if (step === "photo") {
    return (
      <PhotoStep
        categories={options.status === "ready" ? options.categories : []}
        categoriesLoading={options.status === "loading"}
        categoriesError={options.status === "error"}
        onRetryCategories={retryCategories}
        onPassed={handlePassed}
      />
    );
  }

  return <DonateGuide donorLabel={donorLabel} onStart={handleStart} />;
}
