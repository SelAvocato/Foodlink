import { cn } from "@/lib/utils";

/**
 * Metric tile. variant "attention" = warning-tinted count (p34 style).
 * Always keep a written label.
 */
export function StatCard({
  label,
  value,
  variant = "default",
  className,
}: {
  label: string;
  value: string | number;
  variant?: "default" | "brand" | "attention";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl p-5",
        variant === "attention" ? "flex items-center gap-4 bg-warning" : "bg-card",
        className,
      )}
    >
      {variant === "attention" ? (
        <>
          <p className="text-display font-semibold tabular-nums text-warning-foreground">{value}</p>
          <p className="text-body font-medium text-warning-foreground">{label}</p>
        </>
      ) : (
        <>
          <p className="text-body text-muted-foreground">{label}</p>
          <p
            className={cn(
              "mt-2 text-display font-semibold tabular-nums",
              variant === "brand" ? "text-primary" : "text-foreground",
            )}
          >
            {value}
          </p>
        </>
      )}
    </div>
  );
}
