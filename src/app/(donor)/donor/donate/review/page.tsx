import { ReviewStep } from "../review-step";

// Temporary preview route for the static layer; the wizard shell replaces it.
// The values are the Figma sample data; wiring formats the real draft the same way.
export default function ReviewPreviewPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <ReviewStep
          foodName="Fresh bread rolls"
          summary="24 portions · Bakery items · Establishment donor"
          safetyLines={[
            "Visual screening: Pass",
            "Prepared: 4 Nov, 9:00 AM",
            "Consume by: 4 Nov, 6:00 PM",
            "Allergens: Wheat / gluten, Milk",
            "Packaging clean · No opened food or leftovers",
          ]}
          pickupLines={[
            "4 Nov 2026 · 3:00–5:00 PM",
            "18 Mabini Street, Barangay Central",
            "Quezon City",
          ]}
        />
      </div>
    </main>
  );
}
