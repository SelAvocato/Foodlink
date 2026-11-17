import { DetailsStep } from "../details-step";

// Temporary preview route for the static layer; the wizard shell replaces it.
// The two rules are the passing state the Figma page shows.
export default function DetailsPreviewPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <DetailsStep
          categoryName="Bakery items"
          donorLabel="Establishment donor"
          rules={[
            {
              text: "Pickup starts in the future and ends before 6:00 PM consume-by.",
              met: true,
            },
            { text: "Consume-by is later than prepared time.", met: true },
          ]}
        />
      </div>
    </main>
  );
}
