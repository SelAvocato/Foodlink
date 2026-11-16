import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { toneSurface, toneText, type Tone } from "./tones";

/** Content surface. tone="success" is the green info panel used across the PDF. */
export function SectionCard({
  title,
  tone = "neutral",
  as: Heading = "h2",
  className,
  children,
}: {
  title?: string;
  tone?: Tone;
  as?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl p-6",
        tone === "neutral" ? "bg-card" : toneSurface[tone],
        className,
      )}
    >
      {title ? (
        <Heading className={cn("mb-4 text-xl font-semibold leading-7", tone === "neutral" ? "text-foreground" : toneText[tone])}>
          {title}
        </Heading>
      ) : null}
      <div className="text-sm leading-5 text-muted-foreground">{children}</div>
    </section>
  );
}
