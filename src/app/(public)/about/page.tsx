import { LinkButton } from "@/features/public/link-button";
import { PublicPageShell, publicLinks } from "@/features/public/public-page-shell";
import { SectionCard } from "@/components/shared/section-card";

export const metadata = { title: "About the organization - FoodLink" };

const h3 = "text-base font-semibold leading-6 text-primary";

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
      <h1 className="text-[30px] font-semibold leading-10 text-foreground">About the organization</h1>
      <p className="mt-1 text-sm leading-5 text-muted-foreground">FoodLink is operated by one host food recovery organization.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SectionCard title="A stronger connection for good food" className="p-8">
          <div className="space-y-8">
            <section>
              <h3 className={h3}>Mission & vision</h3>
              <p className="mt-2">Awaiting the host organization&apos;s approved mission and vision.</p>
            </section>
            <section>
              <h3 className={h3}>Goals & nature of work</h3>
              <p className="mt-2">
                Coordinate surplus food recovery, volunteer handovers, and documented distribution. Organization-specific goals await confirmation.
              </p>
            </section>
            <section>
              <h3 className={h3}>Organization chart</h3>
              <p className="mt-2">
                Director - Secretary - Board - Executive staff
                <br />
                Names and reporting relationships await confirmation.
              </p>
            </section>
          </div>
        </SectionCard>

        <SectionCard title="Get in touch" tone="success" className="p-8">
          <dl className="space-y-5">
            {contact.map((c) => (
              <div key={c.label}>
                <dt>{c.label}</dt>
                <dd>{c.value}</dd>
              </div>
            ))}
          </dl>
        </SectionCard>
      </div>

      <section className="mt-12" aria-labelledby="pub-h">
        <h2 id="pub-h" className="text-xl font-semibold leading-7 text-foreground">Our work & publications</h2>
        <p className="mt-4 rounded-xl bg-success p-5 text-sm leading-5 text-primary">
          Organization history, accomplishments, services, events, and team details have not yet been supplied.
        </p>
      </section>

      <section className="mt-12" aria-labelledby="cta-h">
        <h2 id="cta-h" className="text-xl font-semibold leading-7 text-foreground">Want to be part of the recovery journey?</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <LinkButton href={publicLinks.donor}>Join as donor</LinkButton>
          <LinkButton href={publicLinks.volunteer} variant="secondary">Volunteer with us</LinkButton>
        </div>
      </section>
    </PublicPageShell>
  );
}
