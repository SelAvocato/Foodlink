import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/shared/skeleton";
import { SCAN_PATH } from "./inspection/pickup-inspection-logic";
import type { TaskView } from "./task-detail-logic";

/** The safety section's own state: only an ASSIGNED task has one. */
export type SafetyState =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "lines"; lines: string[] }
  | { kind: "error" };

/**
 * The p45 task detail body: one centered column, no shell (the volunteer layout
 * owns the app bar and nav). Every value arrives already formatted by the logic.
 */
export function TaskDetailView({
  view,
  safety,
}: {
  view: TaskView;
  safety: SafetyState;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-display font-semibold text-foreground">{view.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{view.subtitle}</p>

      <section className="mt-6 rounded-lg bg-card p-5">
        <p className="text-heading font-semibold text-foreground">{view.summary}</p>
        <div className="mt-4 flex flex-col gap-1 text-base text-muted-foreground">
          <p>{view.donorName}</p>
          {view.donorPhone !== null ? <p>{view.donorPhone}</p> : null}
        </div>
        <div className="mt-4 flex flex-col gap-1 text-base text-muted-foreground">
          <p>{view.address}</p>
          <p>{view.window}</p>
        </div>
      </section>

      <div className="mt-4 rounded-md bg-success p-4">
        <p className="text-body text-primary">Keep food safely stored in transit.</p>
        <p className="mt-1 text-body text-primary">
          Your independent inspection is the final gate.
        </p>
      </div>

      {view.canScan ? (
        <Button asChild className="mt-4 h-[52px] w-full rounded-sm text-base font-semibold">
          <Link href={SCAN_PATH}>Scan pickup QR</Link>
        </Button>
      ) : null}

      {safety.kind === "hidden" ? null : (
        <>
          <h2 className="mt-8 text-heading font-semibold text-foreground">Donor safety details</h2>
          {safety.kind === "loading" ? (
            <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
              <span className="sr-only">Loading donor safety details…</span>
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-11/12" />
              <Skeleton className="h-5 w-10/12" />
            </div>
          ) : safety.kind === "error" ? (
            <p className="mt-3 text-body leading-relaxed text-muted-foreground">
              Donor safety details could not be loaded.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {safety.lines.map((line, index) => (
                <p key={index} className="text-body leading-relaxed text-muted-foreground">
                  {line}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
