import { LinkButton } from "@/features/public/link-button";
import { PublicPageShell, publicLinks } from "@/features/public/public-page-shell";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";

export const metadata = { title: "FoodLink - Good food deserves a second destination" };

const steps = ["Share food", "Organization accepts", "Volunteer inspects & delivers", "Distribution is recorded"];

// Illustrative totals copied from the PDF. No landing API exists - do not add a fetch here.
const impact = [
  { value: "248", label: "Donations completed" },
  { value: "8,420", label: "Portions moved" },
  { value: "7,965", label: "People served" },
  { value: "32", label: "Active volunteers" },
];

const path = [
  { n: "01", t: "Post safely", d: "Upload a food photo and complete the safety checklist." },
  { n: "02", t: "Coordinate", d: "The organization accepts food and assigns an active volunteer." },
  { n: "03", t: "Inspect & deliver", d: "Two independent food checks and QR-verified handovers." },
  { n: "04", t: "See the difference", d: "Distribution records show places and groups served." },
];

export default function LandingPage() {
  return (
    <PublicPageShell>
      <div className="space-y-16 lg:space-y-20">
        <section id="how-it-works" className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium leading-[18px] text-primary">SURPLUS FOOD. SHARED PURPOSE.</p>
            <h1 className="mt-4 text-[30px] font-semibold leading-10 text-foreground lg:text-[44px] lg:leading-[56px]">
              Good food deserves a second destination.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-5 text-muted-foreground">
              Connect your surplus food with the organization and volunteers who help it reach the community. Every portion, accounted for.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href={publicLinks.donor}>Join as donor</LinkButton>
              <LinkButton href={publicLinks.volunteer} variant="secondary">Volunteer with us</LinkButton>
            </div>
            <p className="mt-3 text-xs leading-[18px] text-muted-foreground">Applications are reviewed before you can log in.</p>
          </div>

          <div className="rounded-2xl bg-primary p-6 text-primary-foreground">
            <h2 className="text-xs font-medium leading-[18px]">FROM SURPLUS TO SERVICE</h2>
            <ol className="mt-4 space-y-3">
              {steps.map((s, i) => (
                <li
                  key={s}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-4 text-sm ${
                    i === steps.length - 1 ? "bg-success text-primary" : "bg-primary-foreground/10"
                  }`}
                >
                  <span className="font-medium">0{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="impact" aria-labelledby="impact-h">
          <h2 id="impact-h" className="text-xl font-semibold leading-7 text-foreground">Our collective impact</h2>
          <p className="mt-1 text-xs leading-[18px] text-muted-foreground">
            Illustrative totals calculated from completed donations, except active volunteers
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {impact.map((i) => (
              <StatCard key={i.label} label={i.label} value={i.value} variant="brand" />
            ))}
          </div>
        </section>

        <section aria-labelledby="path-h">
          <h2 id="path-h" className="text-xl font-semibold leading-7 text-foreground">A clear path from kitchen to community</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {path.map((p) => (
              <li key={p.n} className="rounded-xl bg-card p-6">
                <p className="text-xl font-semibold leading-7 text-primary">{p.n}</p>
                <h3 className="mt-4 text-base font-semibold leading-6 text-foreground">{p.t}</h3>
                <p className="mt-1 text-xs leading-[18px] text-muted-foreground">{p.d}</p>
              </li>
            ))}
          </ol>
        </section>

        <SectionCard title="One organization. A shared mission." tone="success" className="p-8">
          <p className="max-w-2xl">
            FoodLink supports one host food recovery organization. Donors share surplus; volunteers handle safe pickup, delivery, and accountable distribution.
          </p>
          <p className="mt-6 text-xs font-medium text-primary">
            Organization name, mission, vision, goals and team details await confirmation.
          </p>
        </SectionCard>

        <section aria-labelledby="events-h">
          <h2 id="events-h" className="text-xl font-semibold leading-7 text-foreground">Events & announcements</h2>
          <p className="mt-1 text-xs leading-[18px] text-muted-foreground">Organization announcements will appear here once supplied.</p>
          <EmptyState
            className="mt-4 p-6"
            title="No announcements published yet"
            description="Check back for updates from the host organization."
          />
        </section>

        <section aria-labelledby="safety-h">
          <h2 id="safety-h" className="text-xl font-semibold leading-7 text-foreground">Safety comes before every handover.</h2>
          <p className="mt-2 max-w-2xl text-sm leading-5 text-muted-foreground">
            Never donate opened food, plate leftovers, or expired items. AI screening is a visual aid only; it cannot detect bacteria, temperature abuse, or allergens.
          </p>
          <div className="mt-4">
            <LinkButton href={publicLinks.safety} variant="secondary">Food safety & FAQ</LinkButton>
          </div>
        </section>
      </div>
    </PublicPageShell>
  );
}
