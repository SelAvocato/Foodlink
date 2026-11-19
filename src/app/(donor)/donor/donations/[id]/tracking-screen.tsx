"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { PostedView } from "@/app/(donor)/donor/donate/posted-view";
import { formatWindow } from "@/app/(donor)/donor/donate/review-logic";
import { REQUEST_TIMEOUT_MS, statusLabel } from "@/app/(donor)/donor/donations/donations-logic";
import { Breadcrumb, type Crumb } from "@/components/shared/breadcrumb";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/shared/skeleton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  CANCEL_FAILURE_MESSAGE,
  classifyCancel,
  classifyLoad,
  labelPickupLines,
  pickupAddress,
  type LoadDecision,
} from "./tracking-screen-logic";
import {
  buildJourney,
  foodSafetyLines,
  parseTrackingResponse,
  pickupCountdown,
  shortCode,
  statusTone,
  trackingActions,
  volunteerText,
  type TrackingReport,
} from "./tracking-logic";
import { TrackingView } from "./tracking-view";

const TIME_ZONE = "Asia/Manila";
const LIST_CRUMB: Crumb = { label: "My donations", href: "/donor/donations" };

/** The answer for one id and attempt; null until it arrives or while it reloads. */
type Answer = { key: string; decision: LoadDecision };

/** The label snapshot the QR dialog shows; it survives a reload behind the dialog. */
type QrLabel = {
  donationId: string;
  foodName: string;
  portions: number;
  pickupLines: string[];
};

/** The report for `id`; status null means the request never completed (timeout/network). */
async function loadReport(
  id: string,
): Promise<{ status: number | null; report: TrackingReport | null }> {
  try {
    // The signal also covers the body read below.
    const response = await fetch(`/api/donor/donations/${encodeURIComponent(id)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // An unreadable body keeps its status: a 404 must still read as "not found".
    const body = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, report: parseTrackingResponse(body) };
  } catch {
    return { status: null, report: null };
  }
}

export function TrackingScreen({ id }: { id: string }) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [qrLabel, setQrLabel] = useState<QrLabel | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // A late answer from an earlier read (or after leaving the page) is dropped.
  const loadRunRef = useRef(0);
  // The confirm button already disables on pending; this drops a second click too.
  const cancelBusyRef = useRef(false);

  const key = `${id}|${attempt}`;

  useEffect(() => {
    loadRunRef.current += 1;
    const mine = loadRunRef.current;
    void loadReport(id).then((result) => {
      if (loadRunRef.current !== mine) return;
      setNowMs(Date.now());
      setAnswer({ key: `${id}|${attempt}`, decision: classifyLoad(result.status, result.report) });
    });
    const runs = loadRunRef;
    return () => {
      runs.current += 1;
    };
  }, [id, attempt]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Only the answer for the current id and attempt counts; anything else is loading.
  const decision = answer !== null && answer.key === key ? answer.decision : null;
  const pickup = decision !== null && decision.kind === "ready" ? decision.report.pickup : null;
  const windowText =
    pickup === null || pickup.pickup_start === null || pickup.pickup_end === null
      ? null
      : formatWindow(pickup.pickup_start, pickup.pickup_end, TIME_ZONE);
  const address = pickupAddress(pickup);

  function handleRetry() {
    setAttempt((value) => value + 1);
  }

  function handleShowQr() {
    if (decision === null || decision.kind !== "ready") return;
    setQrLabel({
      donationId: id,
      foodName: decision.report.donation.food_name ?? "Donation",
      portions: decision.report.donation.portions ?? 0,
      pickupLines: labelPickupLines(windowText, address),
    });
  }

  function handleOpenCancel() {
    setCancelError(null);
    setCancelOpen(true);
  }

  async function handleConfirmCancel() {
    if (cancelBusyRef.current) return;
    cancelBusyRef.current = true;
    setCancelPending(true);
    setCancelError(null);
    try {
      // No body and no Content-Type: the route reads an empty body as "no reason".
      const response = await fetch(`/api/donor/donations/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => null)) as unknown;
      const outcome = classifyCancel(response.status, body);
      if (outcome.kind === "ok") {
        setCancelOpen(false);
        setAttempt((value) => value + 1);
        return;
      }
      setCancelError(outcome.message);
      if (outcome.kind === "refused") {
        // The refusal stays on screen while the report reloads behind the dialog.
        setAttempt((value) => value + 1);
      }
    } catch {
      // Timeout or network failure: the generic message; the dialog stays open to retry.
      setCancelError(CANCEL_FAILURE_MESSAGE);
    } finally {
      cancelBusyRef.current = false;
      setCancelPending(false);
    }
  }

  let content: ReactNode;
  if (decision === null) {
    content = (
      <PendingShell>
        <TrackingSkeleton />
      </PendingShell>
    );
  } else if (decision.kind === "not-found") {
    content = (
      <PendingShell>
        <FeedbackBanner
          tone="error"
          title="Donation not found"
          action={{ label: "Back to My donations", href: "/donor/donations" }}
        >
          We could not find this donation. It may have been removed.
        </FeedbackBanner>
      </PendingShell>
    );
  } else if (decision.kind === "error") {
    content = (
      <PendingShell>
        <FeedbackBanner
          tone="error"
          title="Could not load this donation"
          action={{ label: "Try again", onClick: handleRetry }}
        >
          Check your connection and try again.
        </FeedbackBanner>
      </PendingShell>
    );
  } else {
    const report = decision.report;
    const now = new Date(nowMs); // Ticks every 30 s; the countdown turns null once the window ends.
    const portions = report.donation.portions ?? 0;
    const category = report.donation.category ?? "";
    const crumbs: Crumb[] = [
      LIST_CRUMB,
      {
        label: [
          shortCode(id),
          `${portions} ${portions === 1 ? "portion" : "portions"}`,
          category,
        ]
          .filter((part) => part !== "")
          .join(" · "),
      },
    ];
    content = (
      <TrackingView
        title={report.donation.food_name ?? "Donation"}
        crumbs={crumbs}
        statusLabel={statusLabel(report.donation.status)}
        statusTone={statusTone(report.donation.status)}
        journey={buildJourney(report, TIME_ZONE)}
        pickup={{
          windowText,
          address,
          countdown: pickupCountdown(pickup?.pickup_end ?? null, now),
        }}
        volunteerLines={volunteerText(report.volunteer)}
        foodLines={foodSafetyLines(report, TIME_ZONE)}
        actions={trackingActions(report.donation.status)}
        onShowQr={handleShowQr}
        onCancel={handleOpenCancel}
      />
    );
  }

  return (
    <>
      {content}
      <Dialog
        open={qrLabel !== null}
        onOpenChange={(open) => {
          if (!open) setQrLabel(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          {/* The label carries the content; Radix still wants a title for a11y. */}
          <DialogTitle className="sr-only">Donation QR label</DialogTitle>
          {qrLabel !== null ? (
            <PostedView
              donationId={qrLabel.donationId}
              foodName={qrLabel.foodName}
              portions={qrLabel.portions}
              pickupLines={qrLabel.pickupLines}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={(open) => {
          setCancelOpen(open);
          if (!open) setCancelError(null);
        }}
        title="Cancel this donation?"
        description="This cannot be undone. Your donation will be marked as cancelled."
        confirmLabel="Cancel donation"
        cancelLabel="Keep donation"
        tone="destructive"
        error={cancelError ?? undefined}
        pending={cancelPending}
        onConfirm={handleConfirmCancel}
      />
    </>
  );
}

/** The p13 shell for loading and failure states: header, the one crumb, then the body. */
function PendingShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-col gap-3">
          <PageHeader title="Donation" />
          <Breadcrumb items={[LIST_CRUMB]} />
        </div>
        {children}
      </div>
    </main>
  );
}

/** Loading placeholder shaped like the p13 two-column body. */
function TrackingSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading donation…</span>
      <div aria-hidden className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start">
        <Skeleton className="h-72 w-full" />
        <div className="flex flex-col gap-6">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
