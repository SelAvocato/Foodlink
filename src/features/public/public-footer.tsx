import Link from "next/link";
import { cn } from "@/lib/utils";

const footerLink =
  "inline-flex min-h-11 items-center font-medium text-primary-foreground hover:underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground";

export function PublicFooter({
  links,
  notes,
  compact = false,
}: {
  links: { label: string; href: string }[];
  notes: string[];
  compact?: boolean;
}) {
  return (
    <footer className={cn("bg-primary text-primary-foreground", compact ? "mt-0" : "mt-8")}>
      <div
        className={cn(
          "mx-auto grid max-w-[1200px] px-5 lg:px-8",
          compact ? "gap-5 py-6 sm:grid-cols-2 lg:grid-cols-4" : "gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1.5fr]",
        )}
      >
        <div>
          <p className={cn("font-semibold leading-7", compact ? "text-lg" : "text-xl")}>FoodLink System</p>
          <p className="mt-2 text-sm leading-5 text-primary-foreground/90 text-pretty">Organized food recovery. Transparent community impact.</p>
        </div>
        <nav aria-label="Explore">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-primary-foreground/70">Explore</h2>
          <ul>{links.map((l) => <li key={l.href + l.label}><Link href={l.href} className={footerLink}>{l.label}</Link></li>)}</ul>
        </nav>
        <nav aria-label="Account">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-primary-foreground/70">Account</h2>
          <ul>
            <li><Link href="/login" className={footerLink}>Log in</Link></li>
            <li><Link href="/#join" className={footerLink}>Sign up</Link></li>
          </ul>
        </nav>
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-primary-foreground/70">Notes</h2>
          {notes.map((n) => (
            <p key={n} className={cn("text-sm text-primary-foreground/90 text-pretty [&+p]:mt-2", compact ? "leading-[18px]" : "leading-5")}>
              {n}
            </p>
          ))}
        </div>
      </div>
      <div className="border-t border-primary-foreground/20">
        <div className={cn("mx-auto max-w-[1200px] px-5 text-xs leading-[18px] text-primary-foreground/80 lg:px-8", compact ? "py-3" : "py-5")}>
          Good food. Clear handovers. Accountable impact.
        </div>
      </div>
    </footer>
  );
}
