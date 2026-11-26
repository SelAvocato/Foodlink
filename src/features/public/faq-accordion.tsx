import { ChevronDown } from "lucide-react";

/** Native <details>: keyboard + screen-reader support with zero JS. */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <details key={it.q} className="group rounded-xl bg-card px-6 open:pb-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-semibold leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="text-pretty">{it.q}</span>
            <ChevronDown className="size-5 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden />
          </summary>
          <p className="text-sm leading-5 text-muted-foreground">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
