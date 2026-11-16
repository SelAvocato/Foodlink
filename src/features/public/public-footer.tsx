import Link from "next/link";

export function PublicFooter({
  links,
  notes,
}: {
  links: { label: string; href: string }[];
  notes: string[];
}) {
  return (
    <footer className="mx-auto mb-8 max-w-[1280px] px-5 lg:px-8">
      <div className="rounded-2xl bg-primary p-8 text-primary-foreground">
        <p className="text-xl font-semibold leading-7">FoodLink System</p>
        <p className="mt-2 text-sm leading-5 opacity-90">Organized food recovery. Transparent community impact.</p>
        <p className="mt-6 text-xs leading-[18px] opacity-90">
          {notes.map((n) => (
            <span key={n} className="block">
              {n}
            </span>
          ))}
        </p>
        <nav aria-label="Footer" className="mt-6 flex flex-wrap gap-x-6 text-xs font-medium">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="inline-flex min-h-11 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
