import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WizardProgress } from "./wizard-progress";

export type DetailsRule = { text: string; met: boolean };

type DetailsStepProps = {
  categoryName: string;
  donorLabel: string;
  rules: DetailsRule[];
};

export function DetailsStep({ categoryName, donorLabel, rules }: DetailsStepProps) {
  const allMet = rules.every((rule) => rule.met);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Tell us about the donation</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          Use whole portions and a pickup window before the consume-by time.
        </p>
      </header>

      <WizardProgress currentStep={3} />

      <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:max-w-[85%]">
        <h2 className="text-2xl font-semibold">3. Donation details</h2>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="food-name">Food name</Label>
            <Input id="food-name" className="rounded-sm" type="text" maxLength={160} autoComplete="off" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category · {donorLabel}</Label>
            <Input id="category" className="rounded-sm" value={categoryName} disabled readOnly />
            <p className="text-xs text-(--fl-muted)">Chosen in step 1.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pickup-start">Pickup starts · Must be in the future</Label>
            <Input id="pickup-start" className="rounded-sm" type="datetime-local" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pickup-end">Pickup ends · Before consume-by</Label>
            <Input id="pickup-end" className="rounded-sm" type="datetime-local" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="portions">Portions · Whole number, minimum 1</Label>
            <Input id="portions" className="rounded-sm" type="number" inputMode="numeric" min={1} step={1} />
          </div>

          <div className="hidden sm:block" aria-hidden="true" />

          <fieldset className="grid gap-6 sm:col-span-2 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-medium">Pickup address</legend>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="pickup-street">Street address</Label>
              <Input id="pickup-street" className="rounded-sm" type="text" maxLength={200} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pickup-barangay">Barangay (optional)</Label>
              <Input id="pickup-barangay" className="rounded-sm" type="text" maxLength={120} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pickup-city">City</Label>
              <Input id="pickup-city" className="rounded-sm" type="text" maxLength={120} />
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium">Pickup map pin (optional)</span>
            <div className="flex flex-col gap-3 rounded-sm border border-input px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base text-(--fl-muted)">No pin set yet</p>
              <Button type="button" variant="outline" className="rounded-sm">
                Set location on map
              </Button>
            </div>
          </div>
        </div>

        <ul
          className={`mt-8 flex flex-col gap-2 rounded-sm p-5 text-base ${
            allMet
              ? "bg-(--fl-success) text-(--fl-primary)"
              : "bg-(--fl-warning) text-[#885B16]"
          }`}
        >
          {rules.map((rule) => (
            <li key={rule.text} className="flex items-start gap-2">
              {rule.met ? (
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-current"
                />
              )}
              <span className="sr-only">{rule.met ? "Met: " : "Not met: "}</span>
              <span>{rule.text}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-wrap gap-4">
          <Button type="button" className="w-full rounded-sm sm:w-[14.5rem]">
            Continue
          </Button>
          <Button type="button" variant="outline" className="w-full rounded-sm sm:w-[14.5rem]">
            Back
          </Button>
        </div>
      </section>

      <p className="text-sm text-(--fl-muted)">
        Individuals can select only sealed packaged food, sealed beverages, or whole
        fresh produce.
      </p>
    </div>
  );
}
