"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Skeleton } from "@/components/shared/skeleton";
import Link from "next/link";
import type { DistributionSummary } from "@/contracts/distribution";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function formatDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month! - 1]}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type TaskState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "invalidState" }
  | { kind: "error" }
  | { kind: "ready"; summary: DistributionSummary; entries: DistributionEntryView[] };

async function loadEntries(url: string): Promise<TaskState> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return { kind: "notFound" };
  if (response.status === 409) return { kind: "invalidState" };
  if (!response.ok) return { kind: "error" };
  const body = (await response.json()) as {
    summary: DistributionSummary;
    entries: DistributionEntryView[];
  };
  return { kind: "ready", summary: body.summary, entries: body.entries };
}

function DistributionSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading distribution entries…</span>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-6 rounded-2xl bg-[#176448] p-5">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full w-3/4 animate-pulse rounded-full bg-white" />
        </div>
      </div>
      <div className="mt-6 rounded-xl bg-card p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
      <Skeleton className="mt-4 h-[52px] w-full" />
      <Skeleton className="mt-4 h-16 rounded-xl bg-[#EAF4EE]/60" />
      <Skeleton className="mt-6 h-[52px] w-full" />
    </div>
  );
}

function PrimaryButton({
  children,
  href,
  disabled,
  className,
}: {
  children: React.ReactNode;
  href: string;
  disabled: boolean;
  className?: string;
}) {
  if (disabled) {
    return (
      <span
        className={className}
        aria-disabled="true"
        data-disabled
      >
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function DistributionListScreen({ donationId }: { donationId: string }) {
  const router = useRouter();
  const base = `/api/donations/${encodeURIComponent(donationId)}/distribution-entries`;
  const [state, setState] = useState<TaskState>({ kind: "loading" });
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const loadRun = useRef(0);

  const load = useCallback(() => {
    loadRun.current += 1;
    const mine = loadRun.current;
    void loadEntries(base).then((result) => {
      if (loadRun.current !== mine) return;
      if (result.kind === "notFound" || result.kind === "invalidState") {
        void router.replace(`/volunteer/donations/${encodeURIComponent(donationId)}`);
        return;
      }
      setState(result);
      setError(null);
    }).catch(() => {
      if (loadRun.current !== mine) return;
      setState({ kind: "error" });
    });
  }, [base, donationId, router]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRetry = useCallback(() => {
    setError(null);
    load();
  }, [load]);

  const handleDelete = useCallback((entryId: string) => {
    setDeleteEntryId(entryId);
  }, []);

  const handleKeep = useCallback(() => {
    setDeleteEntryId(null);
  }, []);

  const handleConfirmDelete = useCallback(
    async (entryId: string) => {
      setDeleting(entryId);
      try {
        const response = await fetch(
          `/api/volunteer/donations/${encodeURIComponent(donationId)}/distribution-entries/${encodeURIComponent(entryId)}`,
          { method: "DELETE", cache: "no-store" },
        );
        if (!response.ok) {
          setDeleting(null);
          return;
        }
        setDeleteEntryId(null);
        setDeleting(null);
        load();
      } catch {
        setDeleting(null);
      }
    },
    [donationId, load],
  );

  const current = state;
  if (current.kind === "loading") return <DistributionSkeleton />;
  if (current.kind === "error") {
    return (
      <FeedbackBanner
        tone="error"
        title="Could not load distribution entries"
        action={{
          label: "Try again",
          onClick: handleRetry,
        }}
      >
        Check your connection and try again.
      </FeedbackBanner>
    );
  }
  if (current.kind !== "ready") return null;

  const summary = current.summary;
  const entries = current.entries;
  const isClosed = summary.status === "CLOSED";
  const remainingNegative = summary.remainingQuantity < 0;
  const canAdd = summary.canAddEntry && !remainingNegative && !isClosed;
  const canComplete = summary.canComplete && !remainingNegative && !isClosed;

  return (
    <div className="space-y-5">
      <h1 className="text-display font-semibold text-foreground">Record distribution</h1>
      <p className="text-sm text-muted-foreground">{summary.referenceCode}</p>

      {remainingNegative && (
        <FeedbackBanner tone="warning" title="Remaining portions are negative">
          Reconcile the entries so distributed + unusable equals {summary.totalQuantity}.
        </FeedbackBanner>
      )}

      {/* Progress card */}
      <div className="rounded-2xl bg-[#176448] p-5 text-white">
        <p className="text-3xl font-semibold">
          {summary.distributedQuantity + summary.unusableQuantity} of{" "}
          {summary.totalQuantity} portions
        </p>
        <p className="mt-1 text-sm text-[#176448]/20">
          accounted for · {summary.remainingQuantity} remaining
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full bg-white"
            style={{
              width: Math.min(
                100,
                Math.max(
                  0,
                  ((summary.distributedQuantity + summary.unusableQuantity) /
                    summary.totalQuantity) *
                    100,
                ),
              ),
            }}
          />
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 && !isClosed && !remainingNegative ? (
        <p className="text-sm text-muted-foreground">
          No distribution entries yet. Add the first one.
        </p>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: DistributionEntryView) => (
            <div key={entry.id} className="rounded-xl bg-card p-5 shadow-sm">
              <h3 className="font-semibold text-foreground">{entry.place}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(entry.date)} · {capitalize(entry.groupServed)} ·{" "}
                {entry.peopleServed} people served
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {entry.portionsDistributed} portions distributed ·{" "}
                {entry.portionsUnusable} unusable
              </p>
              {!isClosed && (
                <div className="mt-4 flex gap-3">
                  <Link
                    href={`/tasks/${donationId}/distribution/${entry.id}/edit`}
                    className="flex-1 min-h-11 items-center justify-center rounded-sm border border-[#DCE4DE] bg-white text-[#176448] text-sm font-semibold enabled:hover:bg-[#EAF4EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Edit entry
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry.id)}
                    disabled={deleting !== null}
                    className="flex-1 min-h-11 items-center justify-center rounded-sm border border-[#DCE4DE] bg-white text-[#176448] text-sm font-semibold enabled:hover:bg-[#EAF4EE] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add entry button */}
      {!isClosed && (
        <PrimaryButton
          href={`/tasks/${donationId}/distribution/new`}
          disabled={!canAdd}
          className={`min-h-11 h-[52px] w-full items-center justify-center rounded-xl text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canAdd
              ? "bg-[#176448] text-white enabled:hover:bg-[#12513a]"
              : "border border-[#DCE4DE] bg-[#F2F2F2] text-[#9CA3AF]"
          }`}
        >
          + Add distribution entry
        </PrimaryButton>
      )}

      {/* Note */}
      <p className="rounded-xl bg-[#EAF4EE]/60 p-4 text-sm text-[#63746D]">
        Distributed + unusable must equal {summary.totalQuantity}. No named
        beneficiaries or home addresses.
      </p>

      {/* Complete donation */}
      {isClosed ? (
        <p className="text-sm font-semibold text-muted-foreground">Completed</p>
      ) : (
        <PrimaryButton
          href={`/tasks/${donationId}/distribution/complete`}
          disabled={!canComplete}
          className={`min-h-11 h-[52px] w-full items-center justify-center rounded-xl text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            canComplete
              ? "bg-[#176448] text-white enabled:hover:bg-[#12513a]"
              : "border border-[#DCE4DE] bg-[#F2F2F2] text-[#9CA3AF]"
          }`}
        >
          Complete donation
        </PrimaryButton>
      )}

      {!canComplete && !isClosed && !remainingNegative && (
        <p className="mt-1 text-sm text-[#9CA3AF]">
          Account for the remaining portions before completing.
        </p>
      )}

      {/* Delete dialog */}
      {deleteEntryId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm"
            onClick={handleKeep}
          />
          <div
            className="relative w-full max-w-xs rounded-xl bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-foreground">
              Delete distribution entry?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Assigned volunteer · DELIVERED only. Reconciliation totals will
              update.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={handleKeep}
                className="flex-1 min-h-11 items-center justify-center rounded-sm border border-[#DCE4DE] bg-white text-[#176448] text-sm font-semibold enabled:hover:bg-[#EAF4EE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Keep entry
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(deleteEntryId)}
                disabled={deleting !== null}
                className="flex-1 min-h-11 items-center justify-center rounded-sm bg-[#B3261E] text-white text-sm font-semibold enabled:hover:bg-[#8E1E18] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {deleting === deleteEntryId ? "Deleting…" : "Delete entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
