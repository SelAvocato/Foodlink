import { cn } from "@/lib/utils";

const btn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground disabled:opacity-60";

/** "Showing 1–6 · Previous 1 2 3 Next" */
export function Pagination({
  summary,
  page,
  pageCount,
  onPageChange,
}: {
  summary: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground">{summary}</p>
      <div className="flex items-center">
        <button type="button" className={btn} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={cn(btn, n === page && "bg-success font-semibold")}
            aria-current={n === page ? "page" : undefined}
            aria-label={`Page ${n}`}
            onClick={() => onPageChange(n)}
          >
            {n}
          </button>
        ))}
        <button type="button" className={btn} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}
