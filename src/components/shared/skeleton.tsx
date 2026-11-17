import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-muted/30", className)} />;
}

/** Table-shaped loading placeholder. Announces itself to assistive tech once. */
export function TableSkeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** "Screening in progress" style card with written status + indeterminate bar. */
export function ProgressNotice({
  title,
  children,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={cn("rounded-xl border border-border bg-card p-5", className)}>
      <p className="text-base font-semibold leading-6 text-muted-foreground">{title}</p>
      {children ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{children}</p> : null}
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted/20">
        <div className="h-full w-2/5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
      </div>
    </div>
  );
}
