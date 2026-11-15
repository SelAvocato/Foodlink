import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "cn"

/** Native select styled like Input: accessible, keyboard friendly, no portal. */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full">
      <select
        data-slot="select"
        className={cn(
          "h-11 w-full appearance-none rounded-lg border border-input bg-transparent px-4 pr-11 text-base transition-colors outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  )
}

export { Select }
