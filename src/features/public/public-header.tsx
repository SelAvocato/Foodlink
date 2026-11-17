import Link from "next/link";
import { Leaf } from "lucide-react";

const focus = "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Top bar for p2–p4. Links are props so routes are decided by the page, not invented here. */
export function PublicHeader({
  links,
  loginHref = "/login",
}: {
  links: { label: string; href: string }[];
  loginHref?: string;
}) {
  return (
    <header className="bg-card">
      <div className="mx-auto flex min-h-16 max-w-[1280px] items-center justify-between gap-4 px-5 lg:px-8">
        <Link href="/" className={`flex items-center gap-2 text-xl font-semibold text-primary ${focus}`}>
          <Leaf className="size-6" aria-hidden /> FoodLink
        </Link>
        <nav aria-label="Primary" className="hidden gap-8 text-sm text-muted-foreground md:flex">
          {links.map((l) => (
            <Link key={l.label} href={l.href} className={`hover:text-foreground ${focus}`}>
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href={loginHref} className={`inline-flex min-h-11 items-center text-sm font-semibold text-primary ${focus}`}>
          Login
        </Link>
      </div>
    </header>
  );
}
