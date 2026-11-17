import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { WizardProgress } from "./wizard-progress";

// Static list: the wiring step loads the categories allowed for the donor type.
const CATEGORIES = [
  { code: "COOKED_MEALS", name: "Cooked Meals" },
  { code: "BAKERY", name: "Bakery" },
  { code: "FRESH_PRODUCE", name: "Whole Fresh Produce" },
  { code: "PACKAGED_FOOD", name: "Sealed Packaged Food" },
  { code: "BEVERAGES", name: "Sealed Beverages" },
];

export function PhotoStep() {
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
          <h2 className="text-2xl font-semibold">1. Add a clear food photo</h2>
          <p className="mt-3 text-base text-(--fl-muted)">
            Show the food and its packaging in good light.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="food-category">Food category</Label>
            <div className="w-full sm:max-w-sm">
              <Select id="food-category" defaultValue="" className="rounded-sm">
                <option value="" disabled>
                  Choose a category
                </option>
                {CATEGORIES.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-6 flex min-h-56 flex-col justify-center gap-4 rounded-sm border border-dashed border-(--fl-muted)/40 bg-(--fl-canvas) p-8">
            <h3 className="text-2xl font-semibold text-(--fl-primary)">
              One photo per donation
            </h3>
            <div className="flex flex-col gap-1 text-base text-(--fl-muted)">
              <p>Take a photo or choose an image.</p>
              <p>JPEG, PNG, WebP · Up to 4 MB</p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-4">
            <Button type="button" className="w-full rounded-sm sm:w-[14.5rem]">
              Take photo
            </Button>
            <Button type="button" variant="outline" className="w-full rounded-sm sm:w-[14.5rem]">
              Upload photo
            </Button>
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Button type="button" disabled className="w-full rounded-sm sm:w-[14.5rem]">
          Screen photo
        </Button>
        <p className="text-sm text-(--fl-muted)">
          Add a photo and choose a category to enable screening. AI does not
          guarantee food safety.
        </p>
      </div>
    </div>
  );
}
