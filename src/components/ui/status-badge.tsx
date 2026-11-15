import * as React from "react"
import { cn } from "cn"

type StatusBadgeTone = "success" | "warning" | "error" | "neutral"

const toneClasses: Record<StatusBadgeTone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  error: "bg-error text-error-foreground",
  neutral: "bg-muted text-muted-foreground",
}

/** Written status text always; the tone is a soft fill, never the only signal. */
function StatusBadge({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: StatusBadgeTone }) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        "inline-flex h-8 items-center rounded-full px-3 text-xs font-medium whitespace-nowrap",
        toneClasses[tone],
        className
      )}
      {...props}
    />
  )
}

export { StatusBadge }
