/** Native <details>: keyboard + screen-reader support with zero JS. */
export function FaqAccordion({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="space-y-3">
      {items.map((it) => (
        <details key={it.q} className="group rounded-xl bg-card px-6 open:pb-5">
          <summary className="flex min-h-11 cursor-pointer list-none items-center py-4 text-base font-semibold leading-6 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {it.q}
          </summary>
          <p className="text-sm leading-5 text-muted-foreground">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
