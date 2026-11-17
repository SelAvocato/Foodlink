import { Check } from "lucide-react";

const STEPS = ["Photo", "Safety checklist", "Donation details", "Review & submit"];

export function WizardProgress({ currentStep }: { currentStep: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="grid grid-cols-2 gap-4 rounded-2xl bg-(--fl-card) p-5 sm:grid-cols-4">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const active = step === currentStep;
        const completed = step < currentStep;
        return (
          <li
            key={label}
            className="flex items-center gap-3"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                active
                  ? "bg-(--fl-primary) text-white"
                  : "bg-(--fl-success) text-(--fl-primary)"
              }`}
            >
              {completed ? <Check aria-hidden="true" className="size-4" /> : step}
            </span>
            <span
              className={`text-sm ${
                active ? "font-semibold text-(--fl-primary)" : "text-(--fl-ink)"
              }`}
            >
              {label}
              {completed ? <span className="sr-only"> (completed)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
