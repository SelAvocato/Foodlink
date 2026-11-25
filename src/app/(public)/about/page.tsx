import { LinkButton } from "@/features/public/link-button";
import { PublicPageShell, publicLinks } from "@/features/public/public-page-shell";
import { SectionCard } from "@/components/shared/section-card";

export const metadata = { title: "About the organization - FoodLink" };

// Placeholders are verbatim from the PDF. Do not invent org details.
const contact = [
  { label: "Organization email", value: "Awaiting confirmation" },
  { label: "Contact number", value: "Awaiting confirmation" },
  { label: "Location", value: "Awaiting confirmation" },
  { label: "Social media and department contacts", value: "Only verified details will be published." },
];

export default function AboutPage() {
  return (
    <PublicPageShell>
      <section className="bg-primary py-14 text-primary-foreground lg:py-16" aria-labelledby="about-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary-foreground/80">ABOUT US</p>
          <h1 id="about-h" className="mt-3 max-w-3xl text-balance text-3xl font-semibold leading-tight sm:text-[40px] sm:leading-[1.15]">
            About the organization
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-primary-foreground/90 sm:text-base">
            FoodLink is operated by one host food recovery organization, connecting surplus food with clear, accountable handovers.
          </p>
        </div>
      </section>

      <section className="py-16 lg:py-20" aria-labelledby="mission-h">
        <div className="mx-auto grid max-w-[1200px] gap-6 px-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:px-8">
          <SectionCard title="A stronger connection for good food" className="border border-border p-8" as="h2">
            <div className="space-y-8">
              <section aria-labelledby="mission-h">
                <h3 id="mission-h" className="text-base font-semibold leading-6 text-primary">Mission &amp; vision</h3>
                <p className="mt-2 text-pretty">Awaiting the host organization&apos;s approved mission and vision.</p>
              </section>
              <section aria-labelledby="goals-h">
                <h3 id="goals-h" className="text-base font-semibold leading-6 text-primary">Goals &amp; nature of work</h3>
                <p className="mt-2 text-pretty">
                  Coordinate surplus food recovery, volunteer handovers, and documented distribution. Organization-specific goals await confirmation.
                </p>
              </section>
              <section aria-labelledby="chart-h">
                <h3 id="chart-h" className="text-base font-semibold leading-6 text-primary">Organization chart</h3>
                <p className="mt-2 text-pretty">
                  Director - Secretary - Board - Executive staff
                  <br />
                  Names and reporting relationships await confirmation.
                </p>
              </section>
            </div>
          </SectionCard>

          <SectionCard title="Get in touch" tone="success" className="border border-[#BFDCCB] p-8" as="h2">
            <dl className="space-y-5">
              {contact.map((c) => (
                <div key={c.label}>
                  <dt className="text-sm font-semibold leading-5 text-foreground">{c.label}</dt>
                  <dd className="mt-1 text-sm leading-5 text-muted-foreground text-pretty">{c.value}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </div>
      </section>

      <section className="bg-success/30 py-16 lg:py-20" aria-labelledby="pub-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">OUR WORK</p>
            <h2 id="pub-h" className="mt-3 text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[30px] sm:leading-[1.3]">
              Our work &amp; publications
            </h2>
            <p className="mt-4 rounded-xl border border-border bg-card p-6 text-sm leading-6 text-muted-foreground text-pretty">
              Organization history, accomplishments, services, events, and team details have not yet been supplied.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-20" aria-labelledby="cta-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <h2 id="cta-h" className="text-balance text-xl font-semibold leading-7 text-foreground sm:text-2xl">
                Want to be part of the recovery journey?
              </h2>
              <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">
                Join as a donor or volunteer to help surplus food reach the community through clear, accountable handovers.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              <LinkButton href={publicLinks.donor}>Join as donor</LinkButton>
              <LinkButton href={publicLinks.volunteer} variant="secondary">Volunteer with us</LinkButton>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
