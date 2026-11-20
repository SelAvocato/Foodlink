import { PublicPageShell } from "@/features/public/public-page-shell";
import { FaqAccordion } from "@/features/public/faq-accordion";
import { SectionCard } from "@/components/shared/section-card";

export const metadata = { title: "Food safety & FAQ - FoodLink" };

// Verbatim from PDF p4. NOTE: the PDF shows five Q&As (the brief says six) - not inventing a sixth.
const faq = [
  { q: "Why can't I log in after applying?", a: "The organization reviews your proof document first. Approval or rejection is sent by email." },
  { q: "Who checks donated food?", a: "The donor completes a photo screening and checklist. The assigned volunteer independently photographs and inspects it at pickup." },
  { q: "Where can I see the outcome?", a: "Open My donations and view Where your food went. Reports show places and groups, never individual beneficiaries." },
  { q: "What happens if the pickup window passes?", a: "A donation not picked up becomes Expired. Start a new donation with a fresh photo, checklist, and pickup window." },
  { q: "Can volunteers choose any donation?", a: "No. Volunteers see only donations assigned to them by organization staff." },
];

export default function FoodSafetyPage() {
  return (
    <PublicPageShell>
      <h1 className="text-[30px] font-semibold leading-10 text-foreground">Food safety & frequently asked questions</h1>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">Human judgment comes first. When unsure, do not donate or accept food.</p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <SectionCard title="Establishments may donate" as="h2" className="[&_h2]:text-primary">
          Cooked meals, bakery items, fresh produce, packaged food, and beverages.
        </SectionCard>
        <SectionCard title="Individuals may donate" as="h2" className="[&_h2]:text-primary">
          Sealed packaged food, sealed beverages, and whole fresh produce only.
        </SectionCard>
        <SectionCard title="Never accepted" tone="error" as="h2">
          Opened or partially eaten food, plate leftovers, and items past expiry.
        </SectionCard>
      </div>

      <p role="note" className="mt-6 rounded-xl bg-warning p-5 text-sm leading-5 text-warning-foreground">
        AI-assisted visual screening is not a food safety guarantee. It cannot detect bacterial contamination, temperature abuse, or allergens.
      </p>

      <div className="mt-8">
        <FaqAccordion items={faq} />
      </div>
    </PublicPageShell>
  );
}
