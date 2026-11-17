"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { WizardProgress } from "./wizard-progress";
import {
  PLACEHOLDER_FOOD_NAME,
  PLACEHOLDER_PORTIONS,
  canScreenPhoto,
  donationIdFrom,
  errorCodeFrom,
  messageForError,
  photoUploadMessage,
  photoValidationMessage,
  screeningOutcome,
  validatePhotoFile,
} from "./photo-step-logic";
import { parsePhotoUrl } from "./resume-logic";

// Static list for the preview route only: the wizard loads the categories allowed for the donor type.
export const PREVIEW_CATEGORIES = [
  { code: "COOKED_MEALS", name: "Cooked Meals", requiresPreparedTime: true, requiresStorageInfo: true },
  { code: "BAKERY", name: "Bakery", requiresPreparedTime: true, requiresStorageInfo: true },
  { code: "FRESH_PRODUCE", name: "Whole Fresh Produce", requiresPreparedTime: false, requiresStorageInfo: false },
  { code: "PACKAGED_FOOD", name: "Sealed Packaged Food", requiresPreparedTime: false, requiresStorageInfo: false },
  { code: "BEVERAGES", name: "Sealed Beverages", requiresPreparedTime: false, requiresStorageInfo: false },
];

export type FoodCategoryOption = {
  code: string;
  name: string;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

type PhotoStepProps = {
  categories: FoodCategoryOption[];
  categoriesLoading: boolean;
  categoriesError: boolean;
  onRetryCategories: () => void;
  onPassed: (category: FoodCategoryOption, donationId: string) => void;
  /** Set when the wizard resumed an existing draft: it already has an id and category. */
  initialDraft?: { id: string; categoryCode: string };
};

type StepBanner = {
  tone: "error" | "warning";
  title: string;
  message: string;
  /** Set for a FLAG: offer a fresh start that clears the draft and the step. */
  restart: boolean;
};

const WAITING_BANNER: StepBanner = {
  tone: "warning",
  title: "Waiting for review",
  message: "Staff will review your photo.",
  restart: false,
};

export function PhotoStep({
  categories,
  categoriesLoading,
  categoriesError,
  onRetryCategories,
  onPassed,
  initialDraft,
}: PhotoStepProps) {
  const [categoryCode, setCategoryCode] = useState(initialDraft?.categoryCode ?? "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [waitingForReview, setWaitingForReview] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [banner, setBanner] = useState<StepBanner | null>(null);
  // Signed url of the draft's saved photo: shown, never stored or logged elsewhere.
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  // The ref tracks the live object URL so the unmount cleanup revokes the last one.
  const photoUrlRef = useRef<string | null>(null);
  // Bumped by restart() so a saved-photo read that began earlier is ignored.
  const photoReadRef = useRef(0);

  useEffect(() => {
    return () => {
      if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    };
  }, []);

  // Fetching and applying stay separate so the effect never calls setState
  // synchronously (react-hooks/set-state-in-effect). A 404 or any failure just
  // leaves the state null: the donor simply uploads a photo again.
  const fetchExistingPhotoUrl = useCallback(async (): Promise<string | null> => {
    if (initialDraft === undefined) return null;
    try {
      const response = await fetch(`/api/donor/drafts/${initialDraft.id}/photo`);
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return parsePhotoUrl(body);
    } catch {
      return null;
    }
  }, [initialDraft]);

  const applyExistingPhotoUrl = useCallback((url: string | null) => {
    setExistingPhotoUrl(url);
  }, []);

  useEffect(() => {
    const generation = photoReadRef.current;
    void fetchExistingPhotoUrl().then((url) => {
      // restart() bumps the counter: a read that began before it is stale.
      if (photoReadRef.current === generation) applyExistingPhotoUrl(url);
    });
  }, [fetchExistingPhotoUrl, applyExistingPhotoUrl]);

  const chosenCategory = categories.find((category) => category.code === categoryCode) ?? null;

  function acceptPhoto(file: File) {
    const check = validatePhotoFile({ type: file.type, size: file.size });
    if (!check.ok) {
      // The previous photo stays; the server would refuse this file anyway.
      setFileError(photoValidationMessage(check.error));
      return;
    }
    setFileError(null);
    const nextUrl = URL.createObjectURL(file);
    if (photoUrlRef.current !== null) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = nextUrl;
    setPhotoUrl(nextUrl);
    setPhotoFile(file);
  }

  function clearPhoto() {
    if (photoUrlRef.current !== null) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
    setPhotoUrl(null);
    setPhotoFile(null);
  }

  function handleFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so the same file can be chosen again after a retake.
    event.target.value = "";
    if (file !== undefined) acceptPhoto(file);
  }

  function showRequestError(body: unknown, forPhotoUpload = false) {
    const code = errorCodeFrom(body);
    if (code === "REVIEW_PENDING") {
      setWaitingForReview(true);
      setBanner(WAITING_BANNER);
      return;
    }
    setBanner({ tone: "error", title: "Could not continue", message: forPhotoUpload ? photoUploadMessage(code) : messageForError(code), restart: false });
  }

  function restart() {
    setDraftId(null);
    setCategoryCode("");
    photoReadRef.current += 1;
    setExistingPhotoUrl(null);
    setFileError(null);
    setBanner(null);
    setWaitingForReview(false);
    clearPhoto();
    window.history.replaceState(null, "", window.location.pathname);
  }

  /** The one press that runs the sequence: draft (once) -> photo -> screening. */
  async function handleScreen() {
    if (busy || chosenCategory === null || (photoFile === null && existingPhotoUrl === null)) return;
    const category = chosenCategory;
    setBusy(true);
    setBanner(null);
    try {
      let id = draftId;
      if (id === null) {
        const created = await fetch("/api/donor/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            foodCategoryCode: category.code,
            foodName: PLACEHOLDER_FOOD_NAME,
            portions: PLACEHOLDER_PORTIONS,
          }),
        });
        const createdBody: unknown = await created.json().catch(() => null);
        if (!created.ok) {
          showRequestError(createdBody);
          return;
        }
        const newId = donationIdFrom(createdBody);
        if (newId === null) {
          showRequestError(null);
          return;
        }
        // Stored before any later step can fail, so a retry never creates a second draft.
        setDraftId(newId);
        window.history.replaceState(null, "", `?draft=${newId}`);
        id = newId;
      }

      // A resumed draft with a saved photo has nothing new to upload.
      if (photoFile !== null) {
        const form = new FormData();
        form.append("photo", photoFile);
        const uploaded = await fetch(`/api/donor/drafts/${id}/photo`, { method: "POST", body: form });
        if (!uploaded.ok) {
          showRequestError(await uploaded.json().catch(() => null), true);
          return;
        }
      }

      const screened = await fetch(`/api/donor/drafts/${id}/screening`, { method: "POST" });
      if (!screened.ok) {
        showRequestError(await screened.json().catch(() => null));
        return;
      }

      const outcome = screeningOutcome(await screened.json().catch(() => null));
      if (outcome === null) {
        showRequestError(null);
        return;
      }
      if (outcome.outcome === "passed") {
        onPassed(category, id);
        return;
      }
      if (outcome.outcome === "review") {
        setWaitingForReview(true);
        setBanner(WAITING_BANNER);
        return;
      }
      setBanner({ tone: "error", title: "Photo not accepted", message: outcome.reason, restart: true });
    } catch {
      // Network failure or an unreadable body: the draft id (if any) stays, so a retry is safe.
      showRequestError(null);
    } finally {
      setBusy(false);
    }
  }

  const screenReady = canScreenPhoto({
    hasCategory: chosenCategory !== null,
    hasPhoto: photoFile !== null || existingPhotoUrl !== null,
    busy,
    waitingForReview,
  });

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Donate surplus food</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          Draft saves at every step · You can resume from My donations → Drafts.
        </p>
      </header>

      <WizardProgress currentStep={1} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26.5rem]">
        <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8">
          {categoriesError ? (
            <FeedbackBanner
              tone="error"
              title="Could not load categories"
              action={{ label: "Try again", onClick: onRetryCategories }}
              className="mb-6"
            >
              Food categories could not be loaded.
            </FeedbackBanner>
          ) : null}

          <h2 className="text-2xl font-semibold">1. Add a clear food photo</h2>
          <p className="mt-3 text-base text-(--fl-muted)">
            Show the food and its packaging in good light.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="food-category">Food category</Label>
            <div className="w-full sm:max-w-sm">
              <Select
                id="food-category"
                value={categoryCode}
                onChange={(event) => setCategoryCode(event.target.value)}
                disabled={categoriesLoading || categoriesError || draftId !== null || busy}
                className="rounded-sm"
              >
                <option value="" disabled>
                  Choose a category
                </option>
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-6 flex min-h-56 flex-col justify-center gap-4 rounded-sm border border-dashed border-(--fl-muted)/40 bg-(--fl-canvas) p-8">
            {photoUrl !== null ? (
              <>
                {/* next/image cannot optimize a blob: object URL, so a plain img is required. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photoUrl}
                  alt="Chosen food photo"
                  className="mx-auto max-h-72 rounded-sm object-contain"
                />
                <p className="w-full truncate text-center text-sm text-(--fl-muted)">
                  {photoFile?.name}
                </p>
              </>
            ) : existingPhotoUrl !== null ? (
              <>
                {/* The signed url expires, so a plain img reads it without a next/image loader. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={existingPhotoUrl}
                  alt="Saved food photo"
                  className="mx-auto max-h-72 rounded-sm object-contain"
                />
                <p className="w-full truncate text-center text-sm text-(--fl-muted)">
                  Saved photo
                </p>
              </>
            ) : (
              <>
                <h3 className="text-2xl font-semibold text-(--fl-primary)">
                  One photo per donation
                </h3>
                <div className="flex flex-col gap-1 text-base text-(--fl-muted)">
                  <p>Take a photo or choose an image.</p>
                  <p>JPEG, PNG, WebP · Up to 4 MB</p>
                </div>
              </>
            )}
          </div>

          {fileError === null ? null : (
            <p id="photo-error" role="alert" className="mt-3 text-sm text-destructive">
              {fileError}
            </p>
          )}

          <div
            className="mt-8 flex flex-wrap gap-4"
            aria-describedby={fileError === null ? undefined : "photo-error"}
          >
            <Button
              type="button"
              className="w-full rounded-sm sm:w-[14.5rem]"
              disabled={busy}
              onClick={() => cameraInputRef.current?.click()}
            >
              Take photo
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-sm sm:w-[14.5rem]"
              disabled={busy}
              onClick={() => uploadInputRef.current?.click()}
            >
              Upload photo
            </Button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChosen}
            />
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileChosen}
            />
          </div>
        </section>

        <aside className="rounded-2xl bg-(--fl-success) p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-(--fl-primary) sm:text-2xl">
            Independent check 1 of 2
          </h2>
          <p className="mt-8 text-base text-(--fl-muted)">What happens next?</p>
          <ul className="mt-5 flex flex-col gap-4 text-base text-(--fl-muted)">
            <li>Pass → Continue to checklist</li>
            <li>Review → Staff review the photo; you’ll be notified.</li>
            <li>Flag → Donation is rejected with a reason.</li>
            <li>You can retake the photo before screening.</li>
          </ul>
        </aside>
      </div>

      {banner === null ? null : (
        <FeedbackBanner
          tone={banner.tone}
          title={banner.title}
          action={
            banner.restart
              ? { label: "Start a new donation", onClick: restart }
              : undefined
          }
        >
          {banner.message}
        </FeedbackBanner>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Button
          type="button"
          disabled={!screenReady}
          onClick={() => void handleScreen()}
          className="w-full rounded-sm sm:w-[14.5rem]"
        >
          {busy ? "Screening…" : "Screen photo"}
        </Button>
        <p className="text-sm text-(--fl-muted)">
          Add a photo and choose a category to enable screening. AI does not
          guarantee food safety.
        </p>
      </div>
    </div>
  );
}
