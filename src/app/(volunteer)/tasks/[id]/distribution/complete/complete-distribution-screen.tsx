"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/shared/skeleton";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import type { DistributionSummary } from "@/contracts/distribution";
import type {
  DistributionEntryView,
  UnusableReason,
} from "@/contracts/volunteer-distribution";
import { UNUSABLE_REASON_OPTIONS } from "@/features/volunteer/distribution/options";

type EntriesBody = {
  summary: DistributionSummary;
  entries: DistributionEntryView[];
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: DistributionSummary; entries: DistributionEntryView[] };

const LOAD_FAILED = "Could not load distribution entries";

function unusableLabel(reasons: readonly UnusableReason[]): string {
  if (reasons.length !== 1) return "Unusable";
  const label =
    UNUSABLE_REASON_OPTIONS.find((option) => option.value === reasons[0])?.label ??
    reasons[0];
  return `Unusable · ${label}`;
}

export function CompleteDistributionScreen({ donationId }: { donationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [banner, setBanner] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const run = useRef(0);

  const readUrl = `/api/donations/${encodeURIComponent(donationId)}/distribution-entries`;
  const completedUrl = `/tasks/${encodeURIComponent(donationId)}/distribution/completed`;
  const listUrl = `/tasks/${encodeURIComponent(donationId)}/distribution`;

  useEffect(() => {
    run.current += 1;
    const mine = run.current;

    fetch(readUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (run.current !== mine) return;
        if (response.status === 404) {
          router.replace("/volunteer");
          return;
        }
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setState({ kind: "error", message: LOAD_FAILED });
          return;
        }
        const body = (await response.json().catch(() => null)) as EntriesBody | null;
        if (body === null) {
          setState({ kind: "error", message: LOAD_FAILED });
          return;
        }
        if (body.summary.status === "CLOSED") {
          router.replace(completedUrl);
          return;
        }
        if (!body.summary.canComplete) {
          router.replace(listUrl);
          return;
        }
        setState({ kind: "ready", summary: body.summary, entries: body.entries });
      })
      .catch(() => {
        if (run.current !== mine) return;
        setState({ kind: "error", message: LOAD_FAILED });
      });
  }, [readUrl, completedUrl, listUrl, router, reloadToken]);

  /** Re-read the entries without redirecting, for the 409 branches. */
  const readEntries = useCallback(async (): Promise<EntriesBody | null> => {
    try {
      const response = await fetch(readUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      return (await response.json().catch(() => null)) as EntriesBody | null;
    } catch {
      return null;
    }
  }, [readUrl]);

  const handleRetry = useCallback(() => {
    setState({ kind: "loading" });
    setReloadToken((current) => current + 1);
  }, []);

  const handleComplete = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const response = await fetch(
        `/api/volunteer/donations/${encodeURIComponent(donationId)}/complete`,
        {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (response.status === 200) {
        router.replace(completedUrl);
        return;
      }
      if (response.status === 404) {
        router.replace("/volunteer");
        return;
      }
      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      if (response.status === 409) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        const fresh = await readEntries();
        if (fresh !== null && fresh.summary.status === "CLOSED") {
          router.replace(completedUrl);
          return;
        }
        if (body?.error === "RECONCILIATION_INCOMPLETE") {
          router.replace(listUrl);
          return;
        }
        setBanner(body?.message ?? "The donation could not be completed.");
        setDialogOpen(false);
        setSubmitting(false);
        return;
      }

      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      setBanner(body?.message ?? "The donation could not be completed.");
      setDialogOpen(false);
      setSubmitting(false);
    } catch {
      setBanner("The donation could not be completed. Check your connection and try again.");
      setDialogOpen(false);
      setSubmitting(false);
    }
  }, [submitting, donationId, completedUrl, listUrl, readEntries, router]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading portion totals…</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-[52px] w-full rounded-xl" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <FeedbackBanner
        tone="error"
        title={state.message}
        action={{ label: "Try again", onClick: handleRetry }}
      >
        Check your connection and try again.
      </FeedbackBanner>
    );
  }

  const { summary, entries } = state;
  const reasons = Array.from(
    new Set(
      entries
        .map((entry) => entry.unusableReason)
        .filter((reason): reason is UnusableReason => reason !== null),
    ),
  );
  const places = Array.from(new Set(entries.map((entry) => entry.place)));
  const peopleServed = entries.reduce(
    (total, entry) => total + entry.peopleServed,
    0,
  );

  return (
    <div className="space-y-5">
      <h1 className="text-display font-semibold text-foreground">
        Complete donation
      </h1>
      <p className="text-sm text-muted-foreground">
        {summary.referenceCode} · Review portion totals
      </p>

      {banner !== null ? (
        <FeedbackBanner tone="error" title="Could not complete the donation">
          {banner}
        </FeedbackBanner>
      ) : null}

      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <p className="text-3xl font-semibold text-[#176448]">
          {summary.distributedQuantity + summary.unusableQuantity} of{" "}
          {summary.totalQuantity} accounted for
        </p>
        <dl className="mt-6 space-y-4 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[#63746D]">Donated</dt>
            <dd className="font-semibold text-foreground">{summary.totalQuantity}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[#63746D]">Distributed</dt>
            <dd className="font-semibold text-foreground">
              {summary.distributedQuantity}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[#63746D]">{unusableLabel(reasons)}</dt>
            <dd className="font-semibold text-foreground">
              {summary.unusableQuantity}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[#63746D]">People served</dt>
            <dd className="font-semibold text-foreground">{peopleServed}</dd>
          </div>
        </dl>
      </div>

      <p className="rounded-xl bg-[#EAF4EE]/60 p-4 text-sm text-[#63746D]">
        After completion, distribution records are locked. Donor impact and your
        completed-task total update automatically.
      </p>

      <div className="text-sm text-muted-foreground">
        <p>{summary.entryCount} distribution records</p>
        <p>{places.join(" · ")}</p>
      </div>

      <div className="space-y-3 pt-2">
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full min-h-[48px] rounded-xl bg-[#1B6B46] px-4 py-3 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Confirm completion
        </button>
        <Link
          href={listUrl}
          className="flex w-full min-h-[48px] items-center justify-center rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base font-semibold text-[#1B6B46] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Keep editing records
        </Link>
      </div>

      {dialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => {
              if (!submitting) setDialogOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="complete-dialog-title"
            className="relative w-full max-w-xs rounded-xl bg-card p-6 shadow-lg"
          >
            <h2
              id="complete-dialog-title"
              className="font-semibold text-foreground"
            >
              Complete donation?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Assigned volunteer only. At least one record and every portion
              accounted for. Records become read-only.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                disabled={submitting}
                className="flex-1 min-h-11 items-center justify-center rounded-sm border border-[#DCE4DE] bg-white text-[#176448] text-sm font-semibold enabled:hover:bg-[#EAF4EE] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={submitting}
                className="flex-1 min-h-11 items-center justify-center rounded-sm bg-[#1B6B46] text-white text-sm font-semibold enabled:hover:bg-[#15583A] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {submitting ? "Completing…" : "Complete donation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
