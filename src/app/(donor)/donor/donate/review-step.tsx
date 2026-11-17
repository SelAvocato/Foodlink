import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardProgress } from "./wizard-progress";

type ReviewStepProps = {
  foodName: string;
  summary: string;
  safetyLines: string[];
  pickupLines: string[];
};

const checkboxClass = "size-4 shrink-0 accent-(--fl-primary)";
const sectionHeadingClass =
  "text-xs font-semibold uppercase tracking-wide text-(--fl-primary)";
const listClass = "mt-6 flex flex-col gap-1 text-base text-(--fl-muted)";

export function ReviewStep({
  foodName,
  summary,
  safetyLines,
  pickupLines,
}: ReviewStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Review your donation</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          Check every detail before it becomes available to the organization.
        </p>
      </header>

      <WizardProgress currentStep={4} />

      <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8">
        <div className="flex flex-col-reverse gap-6 border-b border-(--fl-muted)/20 pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">{foodName}</h2>
            <p className="mt-4 text-base text-(--fl-muted)">{summary}</p>
          </div>
          <div className="flex h-28 w-full flex-col justify-end overflow-hidden rounded-md bg-(--fl-success) sm:w-[17rem]">
            <span className="bg-(--fl-ink)/90 px-3 py-1.5 text-xs text-white">
              Food photo
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h3 className={sectionHeadingClass}>Photo &amp; safety</h3>
            <ul className={listClass}>
              <li className="flex flex-wrap items-center gap-x-1">
                Food photo attached ·
                <Button
                  type="button"
                  variant="link"
                  className="h-auto rounded-sm p-0 text-base"
                >
                  View photo
                </Button>
              </li>
              {safetyLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className={sectionHeadingClass}>Pickup details</h3>
            <ul className={listClass}>
              {pickupLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <Button
              type="button"
              variant="link"
              className="mt-4 h-auto rounded-sm p-0 text-base"
            >
              Edit details
              <ArrowRight aria-hidden="true" className="size-4" />
            </Button>
          </div>
        </div>

        <div className="mt-12">
          <label className="flex items-center gap-2 text-lg">
            <input type="checkbox" className={checkboxClass} />
            I confirm this information is true and complete.
          </label>
          <p className="mt-6 text-base text-(--fl-muted)">
            Posting generates a secure QR label and makes your donation available to
            the organization.
          </p>
        </div>

        <div className="mt-10 flex flex-wrap gap-4">
          <Button
            type="button"
            disabled
            className="w-full rounded-sm sm:w-[14.5rem]"
          >
            Submit donation
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-sm sm:w-[14.5rem]"
          >
            Back
          </Button>
        </div>
      </section>

      <p className="text-sm text-(--fl-muted)">
        Posting is enabled only after all required fields and the confirmation are
        complete.
      </p>
    </div>
  );
}
