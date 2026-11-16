import * as React from "react"
import { cn } from "cn"
import type { Tone } from "@/components/shared/tones"

const toneClasses: Record<Tone, string> = {
  success: "bg-success text-success-foreground",
  warning: "bg-warning text-warning-foreground",
  error: "bg-error text-error-foreground",
  neutral: "bg-muted text-muted-foreground",
}

/** Written status text always; the tone is a soft fill, never the only signal. */
function StatusBadge({ tone = "neutral", className, ...props }: React.ComponentProps<"span"> & { tone?: Tone }) {
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
