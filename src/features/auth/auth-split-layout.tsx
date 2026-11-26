import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

function LeafIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

const highlights = [
  "Reviewed donor and volunteer accounts",
  "Clear, QR-verified handovers",
  "Accountable distribution records",
];

export function AuthSplitLayout({
  heroTitle,
  heroNote,
  formTitle,
  formSubtitle,
  children,
}: {
  heroTitle: string[];
  heroNote: string[];
  formTitle: string;
  formSubtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="flex-1 bg-success/30">
      <div className="mx-auto grid w-full max-w-[1200px] flex-1 gap-4 px-4 py-4 sm:px-5 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6 lg:px-8 lg:py-6">
        <section className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-primary p-6 text-primary-foreground sm:p-8 lg:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_40%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.08),transparent_36%)]"
          />

          <Link
            href="/"
            aria-label="FoodLink home"
            className="relative inline-flex min-h-11 w-fit items-center gap-2 rounded-lg text-xl font-semibold leading-7 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
          >
            <LeafIcon />
            <span>FoodLink</span>
          </Link>

          <div className="relative py-8 lg:py-10">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary-foreground/80">DONOR &amp; VOLUNTEER PORTAL</p>
            <h1 className="mt-3 max-w-xl text-balance text-3xl font-semibold leading-tight sm:text-[40px] sm:leading-[1.15]">
              {heroTitle.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <p className="mt-4 max-w-lg text-pretty text-sm leading-6 text-primary-foreground/90">
              {heroNote.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>

            <ul className="mt-6 space-y-2.5" aria-label="Portal highlights">
              {highlights.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-5 text-primary-foreground/95">
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary-foreground/15 text-primary-foreground">
                    <CheckCircle2 className="size-3.5" aria-hidden />
                  </span>
                  <span className="text-pretty">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs font-medium leading-[18px] text-primary-foreground/80">
            Good food. Clear handovers. Accountable impact.
          </p>
        </section>

        <section className="flex items-center">
          <div className="w-full rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7 lg:p-8">
            <p className="text-xs font-semibold leading-[18px] tracking-[0.06em] text-primary">ACCOUNT ACCESS</p>
            <h2 className="mt-2 text-balance text-2xl font-semibold leading-tight text-foreground sm:text-[32px] sm:leading-[1.15]">
              {formTitle}
            </h2>
            <p className="mt-2 text-pretty text-sm leading-5 text-muted-foreground">{formSubtitle}</p>
            <div className="mt-6">{children}</div>
            <p className="mt-6 border-t border-border pt-4 text-xs leading-[18px] text-muted-foreground">
              Approval required <span aria-hidden>•</span> Secure, role-based access
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
