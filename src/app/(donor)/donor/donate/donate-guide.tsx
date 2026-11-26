import { Button } from "@/components/ui/button";

const ESTABLISHMENT_ITEMS = [
  "Cooked meals",
  "Bakery items",
  "Fresh produce",
  "Packaged food",
  "Beverages",
];

const INDIVIDUAL_ITEMS = [
  "Sealed packaged food",
  "Sealed beverages",
  "Whole fresh produce only",
];

const NEVER_ACCEPTED_ITEMS = [
  "Opened or partially eaten food",
  "Leftovers from a customer’s plate",
  "Anything past its expiry date",
  "Sealed packaged food or beverages with 5 months or less left before expiry",
];

const cardClass = "rounded-2xl p-6 sm:p-8";
const headingClass = "text-xl font-semibold sm:text-2xl";
const listClass = "mt-10 flex flex-col gap-1 text-base text-(--fl-muted)";

export function DonateGuide({
  donorLabel,
  onStart,
}: {
  donorLabel: string;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">What can I donate?</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          A quick guide before you start · {donorLabel}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        <section className={`${cardClass} bg-(--fl-success)`}>
          <h2 className={`${headingClass} text-(--fl-primary)`}>
            Accepted from establishments
          </h2>
          <ul className={listClass}>
            {ESTABLISHMENT_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className={`${cardClass} bg-(--fl-card)`}>
          <h2 className={`${headingClass} text-(--fl-primary)`}>
            Accepted from individuals
          </h2>
          <ul className={listClass}>
            {INDIVIDUAL_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className={`${cardClass} bg-(--fl-error)`}>
          <h2 className={`${headingClass} text-[#B23D37]`}>Never accepted</h2>
          <ul className={listClass}>
            {NEVER_ACCEPTED_ITEMS.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      </div>

      <section className={`${cardClass} bg-(--fl-warning) text-[#885B16]`}>
        <h2 className={headingClass}>Your checklist matters.</h2>
        <p className="mt-4 text-sm leading-relaxed">
          AI checks visible signs only. It cannot confirm bacterial safety,
          temperature history, or allergens. The volunteer will independently
          inspect and photograph the food at pickup.
        </p>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
        <Button type="button" className="rounded-sm" onClick={onStart}>Start donation</Button>
        <p className="text-sm text-(--fl-muted)">
          Your progress saves as a draft after each step.
        </p>
      </div>
    </div>
  );
}
