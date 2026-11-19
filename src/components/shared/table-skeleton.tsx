import { cn } from "@/lib/utils";

// A different width per cell, so the rows do not look like one solid block.
const BAR_WIDTHS = ["w-3/4", "w-1/2", "w-1/4", "w-1/3", "w-2/3"] as const;

export type DataTableSkeletonProps = {
  rows?: number;
  columns?: number;
  label?: string;
  className?: string;
};

/** Loading placeholder shaped like a data table. Announces itself to assistive tech once. */
export function DataTableSkeleton({
  rows = 5,
  columns = 5,
  label = "Loading",
  className,
}: DataTableSkeletonProps) {
  const rowKeys = Array.from({ length: rows }, (_value, index) => index);
  const columnKeys = Array.from({ length: columns }, (_value, index) => index);
  const bar = "animate-pulse rounded-sm bg-border motion-reduce:animate-none";
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col", className)}>
      <span className="sr-only">{label}...</span>
      <div aria-hidden className="flex gap-4 border-b border-border px-4 py-3">
        {columnKeys.map((column) => (
          <div key={column} className="flex-1">
            <div className={cn("h-3 w-1/2", bar)} />
          </div>
        ))}
      </div>
      {rowKeys.map((row) => (
        <div
          key={row}
          aria-hidden
          className="flex h-14 items-center gap-4 border-b border-border/60 px-4"
        >
          {columnKeys.map((column) => (
            <div key={column} className="flex-1">
              <div className={cn("h-4", BAR_WIDTHS[(row + column) % BAR_WIDTHS.length], bar)} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
