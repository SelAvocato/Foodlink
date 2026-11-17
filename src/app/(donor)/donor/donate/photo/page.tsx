"use client";

import { PhotoStep, PREVIEW_CATEGORIES } from "../photo-step";

// Temporary preview route for the static layer; the wizard shell replaces it.
export default function PhotoPreviewPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <PhotoStep
          categories={PREVIEW_CATEGORIES}
          categoriesLoading={false}
          categoriesError={false}
          onRetryCategories={() => {}}
          onPassed={() => {}}
        />
      </div>
    </main>
  );
}
