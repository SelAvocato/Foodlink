"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { ChecklistStep } from "./checklist-step";
import { allergenCodesFromDraftList, type AllergenOption } from "./checklist-logic";
import { DonateGuide } from "./donate-guide";
import { PhotoStep, type FoodCategoryOption } from "./photo-step";
import { lookupDraft, type ResumeDraft } from "./resume-logic";

type Step = "guide" | "photo" | "checklist" | "resume";

type OptionsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; categories: FoodCategoryOption[]; allergens: AllergenOption[] };

/** What one food-options request answered: the two lists the wizard reads. */
type FoodOptions = { categories: FoodCategoryOption[]; allergens: AllergenOption[] };

/** What the drafts list said about ?draft=: found it, has no such draft, or could not say. */
type ResumeOutcome =
  | { kind: "found"; draft: ResumeDraft; allergenCodes: string[] }
  | { kind: "missing" }
  | { kind: "failed" };

/** The draft the checklist step works on: the category that passed screening and its id. */
type PassedDraft = {
  category: FoodCategoryOption;
  donationId: string;
  allergenCodes: string[];
};

/** What the resume view shows until it can hand over to a real step. */
type ResumeView = "loading" | "not_found" | "failed";

type DonateWizardProps = {
  hasDraftParam: boolean;
  initialDraftId: string | null;
};

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

export function DonateWizard({ hasDraftParam, initialDraftId }: DonateWizardProps) {
  const [step, setStep] = useState<Step>(hasDraftParam ? "resume" : "guide");
  const [donorLabel, setDonorLabel] = useState("Donor");
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [passedDraft, setPassedDraft] = useState<PassedDraft | null>(null);
  // The allergens a resumed DRAFT already has, kept until it passes screening.
  const [resumedAllergenCodes, setResumedAllergenCodes] = useState<string[]>([]);
  const [resumeView, setResumeView] = useState<ResumeView>("loading");
  const [resumedDraft, setResumedDraft] = useState<{ id: string; categoryCode: string } | null>(
    null,
  );
  // The resume view waits on the same food-options request the wizard already
  // started instead of asking for it a second time.
  const optionsPromiseRef = useRef<Promise<FoodOptions | null> | null>(null);

  // Fetching and applying are separate: the effect only passes the apply
  // callbacks in .then, so it never calls setState synchronously
  // (react-hooks/set-state-in-effect).
  const fetchFoodOptions = useCallback(async (): Promise<FoodOptions | null> => {
    try {
      const response = await fetch("/api/donor/food-options");
      if (!response.ok) return null;
      const body: unknown = await response.json();
      const parsed = foodOptionsSchema.safeParse(body);
      return parsed.success
        ? { categories: parsed.data.categories, allergens: parsed.data.allergens }
        : null;
    } catch {
      return null;
    }
  }, []);

  const applyFoodOptions = useCallback((next: FoodOptions | null) => {
    setOptions(next === null ? { status: "error" } : { status: "ready", ...next });
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
    const foodOptions = fetchFoodOptions();
    optionsPromiseRef.current = foodOptions;
    void foodOptions.then(applyFoodOptions);
    void fetchDonorLabel().then(applyDonorLabel);
  }, [fetchFoodOptions, applyFoodOptions, fetchDonorLabel, applyDonorLabel]);

  // A junk ?draft= makes no request: there is no id worth asking about.
  const fetchResumeOutcome = useCallback(async (): Promise<ResumeOutcome> => {
    if (initialDraftId === null) return { kind: "missing" };
    try {
      const response = await fetch("/api/donor/drafts");
      if (!response.ok) return { kind: "failed" };
      const body: unknown = await response.json();
      const outcome = lookupDraft(body, initialDraftId);
      if (outcome.kind !== "found") return outcome;
      // The same body already holds the draft's allergens; a body without a
      // usable list is a failed resume, never "the draft has none".
      const allergenCodes = allergenCodesFromDraftList(body, initialDraftId);
      if (allergenCodes === null) return { kind: "failed" };
      return { kind: "found", draft: outcome.draft, allergenCodes };
    } catch {
      return { kind: "failed" };
    }
  }, [initialDraftId]);

  // Both answers are needed before deciding: the category must be one the food
  // options really list, or the photo step would render a select that cannot
  // resolve it. The setState calls all run in .then, never in the effect.
  const runResume = useCallback(
    (optionsPromise: Promise<FoodOptions | null>) => {
      void Promise.all([fetchResumeOutcome(), optionsPromise]).then(([outcome, foodOptions]) => {
        if (foodOptions === null || outcome.kind === "failed") {
          setResumeView("failed");
          return;
        }
        if (outcome.kind === "missing") {
          setResumeView("not_found");
          return;
        }
        const category = foodOptions.categories.find(
          (entry) => entry.code === outcome.draft.foodCategoryCode,
        );
        if (category === undefined) {
          setResumeView("failed");
          return;
        }
        if (outcome.draft.status === "DRAFT") {
          setResumedAllergenCodes(outcome.allergenCodes);
          setResumedDraft({
            id: outcome.draft.id,
            categoryCode: outcome.draft.foodCategoryCode,
          });
          setStep("photo");
        } else {
          setPassedDraft({
            category,
            donationId: outcome.draft.id,
            allergenCodes: outcome.allergenCodes,
          });
          setStep("checklist");
        }
      });
    },
    [fetchResumeOutcome],
  );

  useEffect(() => {
    if (step !== "resume") return;
    runResume(optionsPromiseRef.current ?? fetchFoodOptions());
  }, [step, runResume, fetchFoodOptions]);

  function retryCategories() {
    setOptions({ status: "loading" });
    void fetchFoodOptions().then(applyFoodOptions);
  }

  function retryResume() {
    setResumeView("loading");
    const optionsPromise = fetchFoodOptions();
    void optionsPromise.then(applyFoodOptions);
    runResume(optionsPromise);
  }

  /** The draft id leaves the URL, so a reload cannot resume it again. */
  function handleStartOver() {
    window.history.replaceState(null, "", window.location.pathname);
    setStep("guide");
  }

  function handleStart() {
    setStep("photo");
    window.scrollTo({ top: 0 });
  }

  function handlePassed(category: FoodCategoryOption, donationId: string) {
    // A resumed draft keeps the allergens it already has; a fresh pass starts from none.
    const allergenCodes =
      resumedDraft !== null && resumedDraft.id === donationId ? resumedAllergenCodes : [];
    setPassedDraft({ category, donationId, allergenCodes });
    setStep("checklist");
    window.scrollTo({ top: 0 });
  }

  if (step === "checklist" && passedDraft !== null) {
    return (
      <ChecklistStep
        categoryName={passedDraft.category.name}
        requiresPreparedTime={passedDraft.category.requiresPreparedTime}
        requiresStorageInfo={passedDraft.category.requiresStorageInfo}
        donationId={passedDraft.donationId}
        initialAllergenCodes={passedDraft.allergenCodes}
        allergens={options.status === "ready" ? options.allergens : []}
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
        initialDraft={resumedDraft ?? undefined}
      />
    );
  }

  if (step === "resume") {
    if (resumeView === "not_found") {
      return (
        <FeedbackBanner
          tone="error"
          title="Draft not found"
          action={{ label: "Start a new donation", onClick: handleStartOver }}
        >
          We could not find that draft. It may have been posted or removed.
        </FeedbackBanner>
      );
    }
    if (resumeView === "failed") {
      return (
        <FeedbackBanner
          tone="error"
          title="Could not load your draft"
          action={{ label: "Try again", onClick: retryResume }}
        >
          Please try again.
        </FeedbackBanner>
      );
    }
    return <p>Loading your draft…</p>;
  }

  return <DonateGuide donorLabel={donorLabel} onStart={handleStart} />;
}
