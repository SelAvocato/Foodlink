import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toneSurface, type Tone } from "@/components/shared/tones";

/** p10 — named reasons. The eyebrow + title always state the status in words. */
export function StatusNoticeCard({
  tone,
  eyebrow,
  title,
  children,
  href = "/login",
  linkLabel = "Return to login",
}: {
  tone: Tone;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <article className={cn("flex min-h-[280px] flex-col rounded-xl p-6", toneSurface[tone])}>
      <p className="text-xs font-medium leading-[18px] text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-semibold leading-7 text-foreground">{title}</h2>
      <p className="mt-3 text-sm leading-5 text-muted-foreground">{children}</p>
      <Link
        href={href}
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start rounded-lg text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {linkLabel} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </article>
  );
}
