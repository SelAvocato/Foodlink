import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimelineStep = { title: string; detail: string; done: boolean };

/** Donation journey (p13). Done/Pending is written for screen readers. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="space-y-8">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-4">
          {i < steps.length - 1 ? (
            <span aria-hidden className={cn("absolute left-[11px] top-6 h-full w-0.5", s.done ? "bg-primary" : "bg-border")} />
          ) : null}
          <span
            aria-hidden
            className={cn("z-10 grid size-6 shrink-0 place-items-center rounded-full", s.done ? "bg-primary text-primary-foreground" : "bg-border")}
          >
            {s.done ? <Check className="size-4" /> : null}
          </span>
          <div>
            <p className={cn("text-base font-semibold leading-6", s.done ? "text-foreground" : "text-muted-foreground")}>
              {s.title}
              <span className="sr-only">{s.done ? " — completed" : " — pending"}</span>
            </p>
            <p className="text-sm leading-5 text-muted-foreground">{s.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
