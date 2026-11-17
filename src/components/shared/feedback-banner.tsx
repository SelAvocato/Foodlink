import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toneSurface, toneText, type Tone } from "./tones";

const icons = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  neutral: Info,
} as const;

export type FeedbackBannerProps = {
  tone: Tone;
  /** Written status, e.g. "Success", "Warning", "Error", "Already handled". */
  title: string;
  children?: ReactNode;
  /** Inline action beside the message, e.g. "Try again", "Refresh queue". */
  action?: { label: string; onClick?: () => void; href?: string };
  className?: string;
};

/** p43 — inline feedback next to the action (not a global toast). */
export function FeedbackBanner({ tone, title, children, action, className }: FeedbackBannerProps) {
  const Icon = icons[tone];
  const actionClass =
    "mt-3 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl p-4 md:p-5", toneSurface[tone], toneText[tone], className)}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-base font-semibold leading-6">{title}</p>
        {children ? <div className="mt-1 text-sm leading-5">{children}</div> : null}
        {action?.href ? (
          <Link href={action.href} className={actionClass}>
            {action.label} <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : action ? (
          <button type="button" onClick={action.onClick} className={actionClass}>
            {action.label} <ArrowRight className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
