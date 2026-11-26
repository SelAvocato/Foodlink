"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { FilterBar, FilterSelect, SearchInput } from "@/components/shared/filter-bar";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import {
  NOTICE,
  PAGE_SIZE,
  QUEUE_LIMIT,
  REASON_MAX,
  REQUEST_TIMEOUT_MS,
  addressLabel,
  buildCategoryOptions,
  filterRows,
  pageCount,
  pageSlice,
  parseQueueResponse,
  queueLimitNotice,
  reportDetail,
  safePage,
  sortByDeadline,
  summaryText,
  transitionFailure,
  validateReason,
  windowLabel,
  type DonationQueueJson,
} from "./donation-queue-logic";

const EMPTY_ROWS: DonationQueueJson[] = [];

const LIST_ERROR = "The donation queue could not be loaded.";
const DETAIL_ERROR = "The donation details could not be loaded.";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: DonationQueueJson[] };

type DetailState =
  | { status: "idle" }
  | { status: "loading"; donationId: string }
  | { status: "error"; donationId: string }
  | { status: "ready"; donationId: string; report: unknown };

type Banner = {
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
  action?: { label: string; href: string };
};

async function loadQueue(): Promise<DonationQueueJson[] | null> {
  try {
    const response = await fetch(`/api/admin/donations/queue?limit=${QUEUE_LIMIT}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseQueueResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

async function loadDetail(donationId: string): Promise<unknown | null> {
  try {
    const response = await fetch(`/api/admin/donations/${encodeURIComponent(donationId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;
    const report = (body as { report?: unknown }).report;
    return report ?? null;
  } catch {
    return null;
  }
}

export function DonationQueueView() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const loadRunRef = useRef(0);
  const detailRunRef = useRef(0);

  useEffect(() => {
    loadRunRef.current += 1;
    const mine = loadRunRef.current;
    void loadQueue().then((rows) => {
      if (loadRunRef.current !== mine) return;
      setLoad(rows === null ? { status: "error" } : { status: "ready", rows });
    });
    const runs = loadRunRef;
    return () => {
      runs.current += 1;
    };
  }, [retry]);

  const rows = load.status === "ready" ? load.rows : EMPTY_ROWS;
  const limitNotice = load.status === "ready" ? queueLimitNotice(rows.length) : null;

  const categoryOptions = useMemo(() => buildCategoryOptions(rows), [rows]);
  const visible = useMemo(
    () => sortByDeadline(filterRows(rows, { query, category }), ascending),
    [rows, query, category, ascending],
  );

  const pageCountValue = pageCount(visible.length);
  const currentPage = safePage(page, visible.length);
  const pageRows = pageSlice(visible, currentPage);
  const summary = summaryText({ page: currentPage, total: visible.length });

  const selectedRow =
    selectedId === null ? null : (rows.find((row) => row.donationId === selectedId) ?? null);
  const selectedDetail =
    selectedRow !== null && detail.status !== "idle" && detail.donationId === selectedRow.donationId
      ? detail
      : null;
  const lines = selectedDetail?.status === "ready" ? reportDetail(selectedDetail.report) : null;

  function reloadQueue() {
    setLoad({ status: "loading" });
    setRetry((value) => value + 1);
  }

  function review(row: DonationQueueJson) {
    setSelectedId(row.donationId);
    setDetail({ status: "loading", donationId: row.donationId });
    detailRunRef.current += 1;
    const mine = detailRunRef.current;
    void loadDetail(row.donationId).then((report) => {
      if (detailRunRef.current !== mine) return;
      setDetail(
        report === null
          ? { status: "error", donationId: row.donationId }
          : { status: "ready", donationId: row.donationId, report },
      );
    });
  }

  function retryDetail() {
    if (selectedRow === null) return;
    review(selectedRow);
  }

  function removeRow(donationId: string) {
    setLoad((state) =>
      state.status === "ready"
        ? {
            status: "ready",
            rows: state.rows.filter((row) => row.donationId !== donationId),
          }
        : state,
    );
    setSelectedId((current) => (current === donationId ? null : current));
    setDetail((state) =>
      state.status !== "idle" && state.donationId === donationId ? { status: "idle" } : state,
    );
  }

  async function accept(row: DonationQueueJson) {
    if (busy) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await fetch(
        `/api/admin/donations/${encodeURIComponent(row.donationId)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        removeRow(row.donationId);
        setBanner({
          tone: "success",
          title: "Donation accepted",
          action: {
            label: "Assign a volunteer",
            href: "/admin/assignments?donation=" + encodeURIComponent(row.donationId),
          },
          message: `${row.donorName} · ${row.foodName} was accepted.`,
        });
        return;
      }
      const failure = transitionFailure(response.status);
      setBanner({ tone: failure.tone, title: failure.title, message: failure.message });
      if (failure.reload) reloadQueue();
    } catch {
      setBanner({
        tone: "error",
        title: "The donation could not be accepted",
        message: "Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDecline() {
    if (busy || selectedRow === null) return;
    const validation = validateReason(reason);
    if (!validation.ok) {
      setReasonError(validation.message);
      return;
    }
    const row = selectedRow;
    setReasonError(null);
    setBusy(true);
    setBanner(null);
    try {
      const response = await fetch(
        `/api/admin/donations/${encodeURIComponent(row.donationId)}/decline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: validation.reason }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        removeRow(row.donationId);
        setDeclineOpen(false);
        setReason("");
        setBanner({
          tone: "success",
          title: "Donation declined",
          message: `${row.donorName} · ${row.foodName} was declined.`,
        });
        return;
      }
      const failure = transitionFailure(response.status);
      if (failure.refusal) {
        setDeclineOpen(false);
        setReason("");
        setBanner({ tone: failure.tone, title: failure.title, message: failure.message });
        if (failure.reload) reloadQueue();
      } else {
        setReasonError(failure.message);
      }
    } catch {
      setReasonError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] space-y-6">
      <div>
        <h1 className="text-balance text-3xl font-semibold text-foreground sm:text-display">Donation queue</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-body">
          Posted, unexpired donations · Ordered by soonest pickup deadline
        </p>
      </div>

      {banner ? (
        <FeedbackBanner tone={banner.tone} title={banner.title} action={banner.action}>
          {banner.message}
        </FeedbackBanner>
      ) : null}

      <div className="rounded-2xl bg-card p-4 sm:px-6 sm:py-3">
        <FilterBar>
          <SearchInput
            label="Search food or donor"
            placeholder="Search food or donor"
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
          />
          <FilterSelect
            label="Category"
            value={category}
            onChange={(v) => {
              setCategory(v);
              setPage(1);
            }}
            options={categoryOptions}
          />
          <Button type="button" variant="ghost" className="min-h-11 w-full sm:w-auto" onClick={() => setAscending((a) => !a)}>
            {ascending ? "Deadline ↑" : "Deadline ↓"}
          </Button>
        </FilterBar>
      </div>

      <div className="rounded-2xl bg-card p-4 sm:px-6 sm:py-4">
        {load.status === "loading" ? (
          <DataTableSkeleton rows={PAGE_SIZE} columns={5} label="Loading donation queue" />
        ) : load.status === "error" ? (
          <FeedbackBanner
            tone="error"
            title="Could not load the donation queue"
            action={{ label: "Try again", onClick: reloadQueue }}
          >
            {LIST_ERROR} Check your connection and try again.
          </FeedbackBanner>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No donations in the queue"
            description="Posted donations that are waiting for pickup will appear here."
          />
        ) : (
          <>
            <div className="space-y-3 md:hidden">
              {pageRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No donations match your filters.</p>
              ) : (
                pageRows.map((row) => (
                  <article key={row.donationId} className="rounded-xl border border-border p-4">
                    <p className="font-semibold text-foreground">
                      {row.donorName} · {row.foodName}
                    </p>
                    <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <div className="flex gap-2">
                        <dt className="min-w-24 font-medium text-foreground">Portions</dt>
                        <dd>{row.portions}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="min-w-24 font-medium text-foreground">Pickup</dt>
                        <dd>{windowLabel(row.pickupStart, row.pickupEnd)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="min-w-24 font-medium text-foreground">Food check</dt>
                        <dd>Photo + checklist</dd>
                      </div>
                    </dl>
                    <Button type="button" variant="outline" className="mt-4 min-h-11 w-full" onClick={() => review(row)}>
                      Review
                    </Button>
                  </article>
                ))
              )}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <colgroup>
                  <col style={{ width: "30%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "24%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "16%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-xs font-medium text-muted-foreground">
                    <th className="py-4 pr-4 font-medium">Donation / donor</th>
                    <th className="py-4 pr-4 font-medium">Portions</th>
                    <th className="py-4 pr-4 font-medium">Pickup window</th>
                    <th className="py-4 pr-4 font-medium">Food check</th>
                    <th className="py-4 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-muted-foreground">
                        No donations match your filters.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => (
                      <tr key={row.donationId} className="border-b border-border last:border-b-0">
                        <td className="py-4 pr-4 font-semibold text-foreground">
                          {row.donorName} · {row.foodName}
                        </td>
                        <td className="py-4 pr-4 text-muted-foreground">{row.portions}</td>
                        <td className="py-4 pr-4 text-muted-foreground">
                          {windowLabel(row.pickupStart, row.pickupEnd)}
                        </td>
                        <td className="py-4 pr-4 text-muted-foreground">Photo + checklist</td>
                        <td className="py-4">
                          <button
                            type="button"
                            className="min-h-11 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => review(row)}
                          >
                            Review →
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {load.status === "ready" && rows.length > 0 ? (
        <nav aria-label="Queue pagination" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{summary}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </Button>
            <span className="shrink-0 text-sm text-muted-foreground">
              Page {currentPage} of {pageCountValue}
            </span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={currentPage >= pageCountValue}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}

      {limitNotice !== null ? <p className="text-sm text-muted-foreground">{limitNotice}</p> : null}

      {selectedRow !== null ? (
        <section className="rounded-2xl bg-success p-4 sm:p-6 md:p-8">
          {selectedDetail === null || selectedDetail.status === "loading" ? (
            <p className="text-sm text-muted-foreground">Loading donation details…</p>
          ) : selectedDetail.status === "error" ? (
            <>
              <p role="alert" className="text-sm text-muted-foreground">
                {DETAIL_ERROR}
              </p>
              <Button type="button" variant="outline" className="mt-4 min-h-11 w-full sm:w-auto" onClick={retryDetail}>
                Try again
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-balance text-xl font-semibold text-foreground sm:text-2xl">
                {selectedRow.donorName} · {selectedRow.category}
              </h2>
              <div className="mt-4 space-y-1 text-sm text-muted-foreground sm:mt-6 sm:text-body">
                <p>
                  {selectedRow.foodName} · {selectedRow.portions} portions · {selectedRow.donorName}
                </p>
                <p>
                  Pickup: {addressLabel(selectedRow.pickupAddress)} · {windowLabel(selectedRow.pickupStart, selectedRow.pickupEnd)}
                </p>
                <p>
                  Expiry: {lines?.expiry} · {lines?.packaging} · Allergens: {lines?.allergens}
                </p>
              </div>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  className="min-h-11 w-full sm:w-auto sm:min-w-[210px]"
                  onClick={() => void accept(selectedRow)}
                  disabled={busy}
                >
                  Accept donation
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full sm:w-auto sm:min-w-[210px]"
                  onClick={() => {
                    setReason("");
                    setReasonError(null);
                    setDeclineOpen(true);
                  }}
                  disabled={busy}
                >
                  Decline with reason
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <div className="rounded-2xl bg-success px-4 py-4 text-sm text-success-foreground sm:px-6">{NOTICE}</div>

      <Dialog
        open={declineOpen}
        onOpenChange={(open) => {
          setDeclineOpen(open);
          if (!open) {
            setReason("");
            setReasonError(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this donation</DialogTitle>
            <DialogDescription>The donor will see your reason.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="decline-reason">Reason</Label>
          <Textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? "decline-reason-error" : undefined}
          />
          <p className="text-xs text-muted-foreground">
            {reason.length} / {REASON_MAX}
          </p>
          {reasonError ? (
            <p id="decline-reason-error" role="alert" className="text-sm text-destructive">
              {reasonError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setDeclineOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={() => void confirmDecline()} disabled={busy}>
              Decline donation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
