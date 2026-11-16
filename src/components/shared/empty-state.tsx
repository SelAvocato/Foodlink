import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** p43 empty states, e.g. "No tasks assigned. New assignments appear here." */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card p-6 text-left", className)}>
      <h3 className="text-base font-semibold leading-6 text-primary">{title}</h3>
      {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
