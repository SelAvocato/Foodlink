import { ChecklistStep } from "../checklist-step";

// Temporary preview route for the static layer; the wizard shell replaces it.
// Bakery needs a prepared time but no storage info: the state the Figma page shows.
export default function ChecklistPreviewPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ChecklistStep
          categoryName="Bakery"
          requiresPreparedTime
          requiresStorageInfo={false}
        />
      </div>
    </main>
  );
}
