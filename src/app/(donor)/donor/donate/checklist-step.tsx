import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { WizardProgress } from "./wizard-progress";

const STORAGE_CONDITIONS = [
  { value: "ROOM_TEMPERATURE", label: "Room temperature" },
  { value: "HOT_HELD", label: "Hot held" },
  { value: "REFRIGERATED", label: "Refrigerated" },
  { value: "FROZEN", label: "Frozen" },
];

const ALLERGENS = ["Wheat / gluten", "Milk", "Eggs", "Soy", "Nuts", "None"];

type ChecklistStepProps = {
  categoryName: string;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

const checkboxClass = "size-4 shrink-0 accent-(--fl-primary)";

export function ChecklistStep({
  categoryName,
  requiresPreparedTime,
  requiresStorageInfo,
}: ChecklistStepProps) {
  const notApplicable = `Not applicable · ${categoryName} selected`;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Confirm food safety</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          All checklist fields must be completed before you continue.
        </p>
      </header>

      <WizardProgress currentStep={2} />

      <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:max-w-[85%]">
        <h2 className="text-2xl font-semibold">2. Human safety checklist</h2>
        <p className="mt-3 text-base text-(--fl-primary)">
          Photo screening: Pass · A visual aid, not a food safety guarantee.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prepared-at">Time prepared (cooked meals &amp; bakery)</Label>
            {requiresPreparedTime ? (
              <Input id="prepared-at" type="datetime-local" className="rounded-sm" />
            ) : (
              <Input id="prepared-at" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="consume-by-at">Consume-by / expiry</Label>
            <Input id="consume-by-at" type="datetime-local" className="rounded-sm" />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="storage-condition">Storage condition (cooked meals)</Label>
            {requiresStorageInfo ? (
              <Select id="storage-condition" defaultValue="" className="rounded-sm">
                <option value="" disabled>
                  Choose a condition
                </option>
                {STORAGE_CONDITIONS.map((condition) => (
                  <option key={condition.value} value={condition.value}>
                    {condition.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="storage-condition" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="storage-temperature">Temperature °C (cooked meals)</Label>
            {requiresStorageInfo ? (
              <Input
                id="storage-temperature"
                className="rounded-sm"
                type="number"
                inputMode="decimal"
                min={-50}
                max={100}
                step={0.1}
              />
            ) : (
              <Input id="storage-temperature" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>
        </div>

        <fieldset className="mt-8">
          <legend className="text-base font-semibold">Allergens declared</legend>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {ALLERGENS.map((allergen) => (
              <label
                key={allergen}
                className="flex items-center gap-2 text-base text-(--fl-muted)"
              >
                <input type="checkbox" className={checkboxClass} />
                {allergen}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-8 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-base">
            <input type="checkbox" className={checkboxClass} />
            Packaging is intact and clean.
          </label>
          <label className="flex items-center gap-2 text-base">
            <input type="checkbox" className={checkboxClass} />
            Food is not opened, partially eaten, or plate leftovers.
          </label>
        </div>

        <p className="mt-8 text-sm text-(--fl-muted)">
          Prepared time and temperature appear only when applicable to the category.
        </p>

        <div className="mt-10 flex flex-wrap gap-4">
          <Button type="button" className="w-full rounded-sm sm:w-[14.5rem]">
            Continue
          </Button>
          <Button type="button" variant="outline" className="w-full rounded-sm sm:w-[14.5rem]">
            Back
          </Button>
        </div>
      </section>

      <p className="text-sm text-(--fl-muted)">Draft saved · Just now</p>
    </div>
  );
}
