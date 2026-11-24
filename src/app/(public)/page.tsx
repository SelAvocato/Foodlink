import Link from "next/link";
import { PublicPageShell, publicLinks } from "@/features/public/public-page-shell";
import { HeroCarousel } from "@/features/public/hero-carousel";

export const metadata = { title: "FoodLink · Good food deserves a second destination" };

const carouselSteps = [
  { n: "01", title: "Share food", body: "Upload a food photo and complete the safety checklist.", role: "Donor", icon: "share" as const },
  { n: "02", title: "Organization accepts", body: "The organization accepts food and assigns an active volunteer.", role: "Organization staff", icon: "accept" as const },
  { n: "03", title: "Volunteer inspects & delivers", body: "Two independent food checks and QR-verified handovers.", role: "Volunteer", icon: "deliver" as const },
  { n: "04", title: "Distribution is recorded", body: "Distribution records show places and groups served.", role: "Volunteer", icon: "record" as const },
];

const safeguards = [
  {
    title: "Reviewed accounts",
    body: "Donor and volunteer applications are reviewed before login.",
    icon: "review" as const,
  },
  {
    title: "Two independent checks",
    body: "Donor photo screening and checklist, then volunteer photo and three-point inspection at pickup.",
    icon: "checks" as const,
  },
  {
    title: "QR-verified handovers",
    body: "Pickup and drop-off QR scans confirm the correct handover.",
    icon: "qr" as const,
  },
  {
    title: "Accountable, private reporting",
    body: "Distribution records show places and groups served; no individual beneficiary names.",
    icon: "privacy" as const,
  },
];

const donorChecks = [
  "Business permit or valid ID reviewed before approval",
  "Photo screening and safety checklist before posting",
  "QR-verified pickup and handover",
  "Distribution reports show places and groups served",
];
const volunteerChecks = [
  "Valid ID reviewed before approval",
  "Assigned tasks only, no browsing of donations",
  "Your own photo and three-check inspection at pickup",
  "Drop-off QR scan and handover photo",
];

const btnBase = "inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const btnPrimary = `${btnBase} bg-primary text-primary-foreground hover:bg-primary/90`;
const btnOutline = `${btnBase} border border-border bg-card text-primary hover:bg-success hover:border-primary`;
const btnOnDark = `${btnBase} bg-card text-primary hover:bg-card/90 focus-visible:ring-primary-foreground`;
const btnOnDarkOutline = `${btnBase} border border-primary-foreground/45 text-primary-foreground hover:bg-primary-foreground/10 focus-visible:ring-primary-foreground`;

function SafeguardIcon({ name }: { name: "review" | "checks" | "qr" | "privacy" }) {
  const common = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
  if (name === "review") return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="m17 11 2 2 4-4"/></svg>;
  if (name === "checks") return <svg {...common}><path d="M9 11l2 2 4-4"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="m16 5 2 2 4-4"/></svg>;
  if (name === "qr") return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M17 17h4v4h-4z"/><path d="M21 14v1M14 21h1"/></svg>;
  return <svg {...common}><path d="M12 3l7 3v5c0 5-3 7.5-7 10-4-2.5-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>;
}

function CheckIcon() {
  return <svg className="mt-0.5 shrink-0 text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>;
}

function ArrowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
}

function ChevronDownIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>;
}

export default function LandingPage() {
  return (
    <PublicPageShell>
      <section className="relative bg-primary text-primary-foreground">
        <div className="mx-auto grid min-h-[calc(100dvh-68px)] max-w-[1200px] items-center gap-10 px-5 pb-24 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-12 lg:px-8 lg:pb-28 lg:pt-16">
          <div className="max-w-xl">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary-foreground/80">SURPLUS FOOD. SHARED PURPOSE.</p>
            <h1 className="mt-4 max-w-[14ch] text-balance text-4xl font-semibold leading-[1.15] tracking-[-0.01em] sm:text-5xl">Good food deserves a second destination.</h1>
            <p className="mt-4 max-w-[520px] text-pretty text-base leading-6 text-primary-foreground/90">Connect your surplus food with the organization and volunteers who help it reach the community. Every portion, accounted for.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={publicLinks.donor} className={btnOnDark}>Join as donor</Link>
              <Link href={publicLinks.volunteer} className={btnOnDarkOutline}>Volunteer with us</Link>
            </div>
            <p className="mt-3 text-xs leading-[18px] text-primary-foreground/80">Applications are reviewed before you can log in.</p>
            <div className="mt-4">
              <Link href="/how-it-works" className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-primary-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary">
                See how it works in full <ArrowIcon />
              </Link>
            </div>
          </div>
          <div className="min-w-0 w-full self-center overflow-hidden">
            <HeroCarousel steps={carouselSteps} />
          </div>
        </div>
        <a href="#safeguards" className="absolute inset-x-0 bottom-5 flex min-h-11 items-center justify-center gap-2 text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-inset">
          <span>Explore safeguards</span>
          <ChevronDownIcon />
        </a>
      </section>

      <section id="safeguards" className="bg-success/30 py-16 lg:py-20" aria-labelledby="safeguards-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">BUILT FOR TRUST</p>
            <h2 id="safeguards-h" className="mt-3 text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[30px] sm:leading-[1.3]">Built-in safeguards at every handover</h2>
            <p className="mt-3 text-pretty text-sm leading-5 text-muted-foreground">Clear checks, verified handovers, and accountable reporting keep surplus food moving safely.</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {safeguards.map((s) => (
              <article key={s.title} className="flex flex-col items-center rounded-xl border border-border bg-card p-6 text-center">
                <span className="grid size-14 place-items-center rounded-2xl bg-success text-primary"><SafeguardIcon name={s.icon} /></span>
                <h3 className="mt-5 text-balance text-base font-semibold leading-6 text-foreground">{s.title}</h3>
                <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-20" id="join" aria-labelledby="join-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <h2 id="join-h" className="text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[30px] sm:leading-[1.3]">Join FoodLink</h2>
          <p className="mt-2 max-w-[620px] text-sm leading-5 text-muted-foreground text-pretty">Submit your details for organization review. Login becomes available after approval.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <article className="flex flex-col rounded-xl border border-border bg-card p-8">
              <span className="self-start rounded-full border border-[#BFDCCB] bg-success px-3 py-[3px] text-xs font-semibold leading-[18px] text-primary">Surplus Food Donors</span>
              <h3 className="mt-4 text-2xl font-semibold leading-8 text-foreground text-balance">For Establishment &amp; Individual Donors</h3>
              <p className="mt-3 text-sm leading-[22px] text-muted-foreground text-pretty">Establishments can share cooked meals, bakery items, fresh produce, packaged food and beverages. Individuals can share sealed packaged food, sealed beverages and whole fresh produce.</p>
              <ul className="mt-5 mb-7 grid gap-2.5">
                {donorChecks.map((c) => <li key={c} className="flex gap-2.5 text-sm leading-5 text-foreground"><CheckIcon /><span className="text-pretty">{c}</span></li>)}
              </ul>
              <Link href={publicLinks.donor} className={`${btnPrimary} mt-auto self-start`}>Register as Donor</Link>
            </article>
            <article className="flex flex-col rounded-xl border border-border bg-card p-8">
              <span className="self-start rounded-full border border-[#F0D9A6] bg-warning px-3 py-[3px] text-xs font-semibold leading-[18px] text-warning-foreground">Volunteers</span>
              <h3 className="mt-4 text-2xl font-semibold leading-8 text-foreground text-balance">For Approved Volunteers</h3>
              <p className="mt-3 text-sm leading-[22px] text-muted-foreground text-pretty">Volunteers see only the donations that organization staff assign to them, then pick up, deliver and record where the food went.</p>
              <ul className="mt-5 mb-7 grid gap-2.5">
                {volunteerChecks.map((c) => <li key={c} className="flex gap-2.5 text-sm leading-5 text-foreground"><CheckIcon /><span className="text-pretty">{c}</span></li>)}
              </ul>
              <Link href={publicLinks.volunteer} className={`${btnOutline} mt-auto self-start`}>Register as Volunteer</Link>
            </article>
          </div>
        </div>
      </section>

      <section className="pb-6" aria-labelledby="org-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="rounded-xl border border-border bg-card px-6 py-5">
            <h2 id="org-h" className="text-sm font-semibold leading-5 text-foreground">One organization. A shared mission.</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground text-pretty">FoodLink supports one host food recovery organization. Organization name, mission, vision, goals and team details await confirmation.</p>
          </div>
        </div>
      </section>

      <section className="pb-16 pt-6" aria-labelledby="safe-h">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="safe-h" className="text-balance text-xl font-semibold leading-7 text-foreground sm:text-2xl">Safety comes before every handover.</h2>
              <p className="mt-2 max-w-[640px] text-sm leading-5 text-muted-foreground text-pretty">Never donate opened food, plate leftovers, or expired items. AI screening is a visual aid only; it cannot detect bacteria, temperature abuse, or allergens.</p>
            </div>
            <Link href={publicLinks.safety} className={`${btnOutline} shrink-0 self-start`}>Food safety &amp; FAQ</Link>
          </div>
        </div>
      </section>

      <section className="bg-primary py-14 text-primary-foreground lg:py-16" aria-labelledby="closing-h">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-5 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="max-w-2xl">
            <h2 id="closing-h" className="text-balance text-2xl font-semibold leading-tight sm:text-[30px] sm:leading-[1.3]">Want to be part of the recovery journey?</h2>
            <p className="mt-3 text-pretty text-sm leading-5 text-primary-foreground/90">Join as a donor or volunteer to help surplus food reach the community through clear, accountable handovers.</p>
            <p className="mt-2 text-xs leading-[18px] text-primary-foreground/80">Applications are reviewed before you can log in.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href={publicLinks.donor} className={btnOnDark}>Join as donor</Link>
            <Link href={publicLinks.volunteer} className={btnOnDarkOutline}>Volunteer with us</Link>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
