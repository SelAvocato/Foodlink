import Link from "next/link";

export type Crumb = { label: string; href?: string };

/** "Workspace / Overview" */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {items.map((c, i) => (
          <li key={c.label} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {c.href ? (
              <Link href={c.href} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {c.label}
              </Link>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
