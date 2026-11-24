import Link from "next/link";
import { PublicPageShell, publicLinks } from "@/features/public/public-page-shell";

export const metadata = { title: "How it works · FoodLink" };

const steps = [
  {
    n: "01",
    role: "Donor",
    title: "Share food",
    intro: "Post your surplus food safely, with a photo and a checklist.",
    checks: [
      "Take or upload one food photo (JPEG, PNG or WebP, up to 5 MB)",
      "Photo screening gives a visual verdict: Pass continues, Review goes to staff, Flag is rejected with a reason",
      "Complete the safety checklist: prepared time, consume-by, allergens and packaging",
      "Review and submit to generate a secure QR label for pickup",
    ],
    icon: "share" as const,
  },
  {
    n: "02",
    role: "Organization staff",
    title: "Organization accepts",
    intro: "Staff review every donation before a volunteer is sent.",
    checks: [
      "Photos marked Review are passed or rejected by staff, with a reason",
      "Posted donations appear in a queue ordered by soonest pickup deadline",
      "Staff accept the donation, or decline it with a reason for the donor",
      "Staff assign an active volunteer, who receives the pickup details",
    ],
    icon: "accept" as const,
  },
  {
    n: "03",
    role: "Volunteer",
    title: "Volunteer inspects & delivers",
    intro: "Food only leaves the donor after the volunteer's own inspection passes.",
    checks: [
      "Volunteers see only donations assigned to them",
      "Scan the pickup QR, take your own photo, and answer three checks: all must be Yes",
      "When unsure, reject the pickup. Food flagged by screening cannot be accepted",
      "Scan the drop-off QR and add a handover photo to confirm delivery",
    ],
    icon: "deliver" as const,
  },
  {
    n: "04",
    role: "Volunteer",
    title: "Distribution is recorded",
    intro: "Every portion is accounted for before a donation is complete.",
    checks: [
      "Record where the food went: place, group served, people served and portions",
      "Distributed plus unusable portions must equal the portions donated",
      "Records lock once the volunteer completes the donation",
      "Donors see where your food went: places and groups, never individual beneficiaries",
    ],
    icon: "record" as const,
  },
];

const btnBase = "inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const btnPrimary = `${btnBase} bg-primary text-primary-foreground hover:bg-primary/90`;
const btnOutline = `${btnBase} border border-border bg-card text-primary hover:bg-success hover:border-primary`;

function StepIcon({ name }: { name: "share" | "accept" | "deliver" | "record" }) {
  const common = { width: 48, height: 48, viewBox: "0 0 64 64", fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };
  if (name === "share") return <svg {...common}><path d="M14 30h36l-3.6 23.1a4 4 0 0 1-4 3.4H21.6a4 4 0 0 1-4-3.4L14 30Z"/><path d="M11 30h42"/><path d="M25 38v12M32 38v12M39 38v12"/><circle cx="24" cy="21" r="6.5"/><path d="M24 14.5c0-2.6 1.4-4.2 3.8-4.8"/><path d="M35 29c-.8-8 3.2-13.6 10-13.6.8 7-3 12.2-10 13.6Z"/></svg>;
  if (name === "accept") return <svg {...common}><rect x="14" y="12" width="36" height="44" rx="5"/><rect x="24" y="7" width="16" height="9" rx="3"/><path d="M23 35l6.5 6.5L42 28"/></svg>;
  if (name === "deliver") return <svg {...common}><rect x="6" y="16" width="31" height="28" rx="3"/><path d="M37 26h9.5l9.5 10.5V44H37"/><path d="M15 30l5.5 5.5L29 26"/><circle cx="19" cy="46" r="5" fill="var(--color-success)"/><circle cx="46" cy="46" r="5" fill="var(--color-success)"/></svg>;
  return <svg {...common}><rect x="13" y="8" width="38" height="48" rx="5"/><path d="M22 22h2M30 22h14M22 31h2M30 31h14M22 40h2M30 40h9"/><path d="M22 48h20"/></svg>;
}

function CheckIcon() {
  return <svg className="mt-0.5 shrink-0 text-primary" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>;
}

export default function HowItWorksPage() {
  return (
    <PublicPageShell>
      <section className="py-14 lg:py-16">
        <div className="mx-auto max-w-[1200px] px-5 lg:px-8">
          <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">FROM SURPLUS TO SERVICE</p>
          <h1 className="mt-3 max-w-[18ch] text-balance text-4xl font-semibold leading-[1.15] tracking-[-0.01em] text-foreground sm:text-5xl">How it works</h1>
          <p className="mt-4 max-w-[640px] text-pretty text-base leading-6 text-muted-foreground">A clear path from kitchen to community. Every step is checked, confirmed and recorded.</p>

          <ol className="mt-10 grid gap-6">
            {steps.map((s) => (
              <li key={s.n} className="overflow-hidden rounded-2xl border border-border bg-card md:grid md:grid-cols-[240px_minmax(0,1fr)]">
                <div className="flex items-center gap-4 bg-success p-6 text-primary md:flex-col md:justify-center md:gap-3 md:p-8">
                  <span className="grid size-14 place-items-center rounded-xl bg-card text-primary md:size-[72px]"><StepIcon name={s.icon} /></span>
                  <span className="text-3xl font-semibold leading-10 md:text-5xl md:leading-none">{s.n}</span>
                </div>
                <div className="p-6 md:p-8">
                  <span className="inline-flex rounded-full border border-[#BFDCCB] bg-success px-3 py-[3px] text-xs font-semibold leading-[18px] text-primary">{s.role}</span>
                  <h2 className="mt-3 text-2xl font-semibold leading-8 text-foreground text-balance">{s.title}</h2>
                  <p className="mt-2 text-sm leading-5 text-muted-foreground text-pretty">{s.intro}</p>
                  <ul className="mt-5 grid gap-2.5">
                    {s.checks.map((c) => (
                      <li key={c} className="flex gap-2.5 text-sm leading-5 text-foreground">
                        <CheckIcon />
                        <span className="text-pretty">{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-10 rounded-2xl bg-warning p-6 md:p-8" role="note">
            <h2 className="text-xl font-semibold leading-7 text-warning-foreground text-balance">Safety comes before every handover.</h2>
            <p className="mt-2 max-w-[720px] text-sm leading-5 text-warning-foreground text-pretty">Never donate opened food, plate leftovers, or expired items. AI screening is a visual aid only; it cannot detect bacteria, temperature abuse, or allergens.</p>
          </div>

          <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div>
              <h2 className="text-xl font-semibold leading-7 text-foreground text-balance">Want to be part of the recovery journey?</h2>
              <p className="mt-1 text-xs leading-[18px] text-muted-foreground">Applications are reviewed before you can log in.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={publicLinks.donor} className={btnPrimary}>Join as donor</Link>
              <Link href={publicLinks.volunteer} className={btnOutline}>Volunteer with us</Link>
            </div>
          </div>
        </div>
      </section>
    </PublicPageShell>
  );
}
