import { AlertTriangle } from "lucide-react";
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
      <section className="bg-primary py-14 text-primary-foreground lg:py-16" aria-labelledby="food-safety-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary-foreground/80">FOOD SAFETY</p>
          <h1 id="food-safety-h" className="mt-3 max-w-3xl text-balance text-3xl font-semibold leading-tight sm:text-[40px] sm:leading-[1.15]">
            Food safety &amp; frequently asked questions
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-primary-foreground/90 sm:text-base">
            Human judgment comes first. When unsure, do not donate or accept food.
          </p>
        </div>
      </section>

      <section className="py-16 lg:py-20" aria-labelledby="guidelines-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">DONATION GUIDELINES</p>
            <h2 id="guidelines-h" className="mt-3 text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[30px] sm:leading-[1.3]">
              Know what can be shared safely
            </h2>
            <p className="mt-3 text-pretty text-sm leading-5 text-muted-foreground">
              Follow these rules before posting or accepting a donation to protect everyone involved.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <SectionCard title="Establishments may donate" as="h3" className="border border-border p-6 [&_h3]:text-primary">
              <p className="text-pretty">Cooked meals, bakery items, fresh produce, packaged food, and beverages.</p>
            </SectionCard>
            <SectionCard title="Individuals may donate" as="h3" className="border border-border p-6 [&_h3]:text-primary">
              <p className="text-pretty">Sealed packaged food, sealed beverages, and whole fresh produce only.</p>
            </SectionCard>
            <section className="rounded-xl border border-red-200 bg-red-50 p-6" aria-labelledby="never-accepted-h">
              <div className="mb-4 flex items-center gap-2 text-red-700">
                <AlertTriangle className="size-5 shrink-0" aria-hidden />
                <p className="text-xs font-semibold uppercase tracking-[0.06em]">Danger</p>
              </div>
              <h3 id="never-accepted-h" className="text-xl font-semibold leading-7 text-red-900">Never accepted</h3>
              <p className="mt-3 text-sm leading-5 text-red-950 text-pretty">
                Opened or partially eaten food, plate leftovers, and items past expiry.
              </p>
            </section>
          </div>

          <p role="note" className="mt-6 flex gap-3 rounded-xl border border-[#F0D9A6] bg-warning p-5 text-sm leading-5 text-warning-foreground">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span className="text-pretty">
              AI-assisted visual screening is not a food safety guarantee. It cannot detect bacterial contamination, temperature abuse, or allergens.
            </span>
          </p>
        </div>
      </section>

      <section className="bg-success/30 py-16 lg:py-20" aria-labelledby="faq-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">FAQ</p>
            <h2 id="faq-h" className="mt-3 text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[30px] sm:leading-[1.3]">
              Frequently asked questions
            </h2>
          </div>
          <div className="mt-8">
            <FaqAccordion items={faq} />
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
