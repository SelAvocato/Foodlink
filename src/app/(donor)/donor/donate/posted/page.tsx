import { PostedLabel } from "../posted-label";

// Temporary preview route for the static layer; the wizard shell replaces it.
// The QR slot is a plain box on purpose: no sample QR that someone could scan.
export default function PostedPreviewPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <PostedLabel
          foodName="Fresh bread rolls"
          shortCode="#FL-0270"
          portionsText="24 portions"
          pickupText="Pickup: Today, 3:00–5:00 PM"
          qrSlot={
            <div className="flex size-60 items-center justify-center rounded-sm border border-dashed border-(--fl-muted)/40 text-sm text-(--fl-muted)">
              QR code appears here
            </div>
          }
        />
      </div>
    </main>
  );
}
