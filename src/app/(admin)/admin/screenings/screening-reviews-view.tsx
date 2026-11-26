"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import type { ScreeningDecisionBody } from "@/contracts/screening-decision";
import {
  GENERIC_ERROR,
  caseTitle,
  checklistLines,
  confidenceLabel,
  countLabel,
  decisionMessage,
  nextAfterDecision,
  parseScreeningQueue,
  passBody,
  reasonText,
  reconcileActive,
  showQueueError,
  validateReject,
  type ScreeningCase,
} from "./screening-reviews-logic";

const EMPTY_CASES: ScreeningCase[] = [];
const LIST_ERROR = "The screening queue could not be loaded.";
const QUIET_REFILL_MS = 240000;

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cases: ScreeningCase[] };

export function ScreeningReviewsView() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<ScreeningCase | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const loadSeq = useRef(0);
  const latestQueue = useRef<ScreeningCase[]>([]);

  const loadCases = useCallback(async (): Promise<ScreeningCase[] | null> => {
    try {
      const response = await fetch("/api/admin/screenings?limit=100");
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return parseScreeningQueue(body);
    } catch {
      return null;
    }
  }, []);

  const applyCases = useCallback((cases: ScreeningCase[] | null) => {
    if (cases === null) {
      setLoad({ status: "error" });
      return;
    }
    latestQueue.current = cases;
    setPinned((held) => held ?? cases[0] ?? null);
    setRefreshFailed(false);
    setLoad({ status: "ready", cases });
  }, []);

  const loadLatest = useCallback(async (): Promise<{ isStale: () => boolean; cases: ScreeningCase[] | null }> => {
    loadSeq.current += 1;
    const mine = loadSeq.current;
    const cases = await loadCases();
    return { isStale: () => mine !== loadSeq.current, cases };
  }, [loadCases]);

  useEffect(() => {
    void loadLatest().then((r) => {
      if (!r.isStale()) applyCases(r.cases);
    });
  }, [loadLatest, applyCases]);

  function reload() {
    setLoad({ status: "loading" });
    void loadLatest().then((r) => {
      if (!r.isStale()) applyCases(r.cases);
    });
  }

  const refill = useCallback(() => {
    void loadLatest().then((r) => {
      if (r.isStale()) return;
      if (r.cases !== null) {
        applyCases(r.cases);
        return;
      }
      setRefreshFailed(true);
      setLoad((state) => (state.status === "loading" ? { status: "error" } : state));
    });
  }, [loadLatest, applyCases]);

  useEffect(() => {
    const refillIfVisible = () => {
      if (document.visibilityState === "visible") refill();
    };
    const intervalId = setInterval(refillIfVisible, QUIET_REFILL_MS);
    document.addEventListener("visibilitychange", refillIfVisible);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refillIfVisible);
    };
  }, [refill]);

  function applyOwnDecision(screeningId: string) {
    const next = latestQueue.current.filter((c) => c.screeningId !== screeningId);
    latestQueue.current = next;
    setLoad((state) => (state.status === "ready" ? { status: "ready", cases: next } : state));
    setPinned(nextAfterDecision(latestQueue.current, screeningId));
  }

  const cases = load.status === "ready" ? load.cases : EMPTY_CASES;
  const { current, gone } = reconcileActive(pinned, cases);
  const showError = showQueueError(load.status, cases.length, current !== null, refreshFailed);

  async function submitDecision(target: ScreeningCase, body: ScreeningDecisionBody) {
    if (busy) return;
    setBusy(true);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/admin/screenings/${target.screeningId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        applyOwnDecision(target.screeningId);
        refill();
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        return;
      }
      const errorBody: unknown = await response.json().catch(() => null);
      const failure = decisionMessage(response.status, errorBody);
      if (failure.refill || body.decision === "PASS") {
        setDecisionError(failure.message);
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        if (failure.refill) refill();
      } else {
        setReasonError(failure.message);
      }
    } catch {
      if (body.decision === "REJECT") setReasonError(GENERIC_ERROR);
      else setDecisionError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  function openReject() {
    if (current === null) return;
    setReason("");
    setReasonError(null);
    setRejectTargetId(current.screeningId);
    setRejectOpen(true);
  }

  function confirmReject() {
    const target = cases.find((c) => c.screeningId === rejectTargetId) ?? null;
    if (target === null) {
      setRejectOpen(false);
      setReason("");
      return;
    }
    if (busy) return;
    const validation = validateReject(reason);
    if (!validation.ok) {
      setReasonError(validation.message);
      return;
    }
    setReasonError(null);
    void submitDecision(target, validation.body);
  }

  return (
    <div className="min-h-0 text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-primary">Workspace / Screening reviews</p>
          <h1 className="text-balance text-3xl font-semibold sm:text-display">Screening reviews</h1>
          <p className="text-sm text-muted-foreground sm:text-body">
            Only REVIEW verdicts enter this queue. FLAG verdicts are rejected automatically.
          </p>
        </header>

        {load.status === "ready" && !showError ? (
          <p className="font-semibold text-warning-foreground">{countLabel(cases.length)}</p>
        ) : null}

        {load.status === "ready" && refreshFailed && !showError ? (
          <div
            role="status"
            className="flex flex-col gap-3 rounded-xl bg-warning px-4 py-3 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <p>The queue could not be refreshed, so photo links may have expired.</p>
            <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={refill}>
              Refresh now
            </Button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
          {load.status === "loading" ? (
            <section aria-busy="true" className="rounded-2xl bg-card p-4 sm:p-6 md:p-8 lg:col-span-2">
              <p className="text-muted-foreground">Loading cases…</p>
            </section>
          ) : showError ? (
            <section className="rounded-2xl bg-card p-4 sm:p-6 md:p-8 lg:col-span-2">
              <p role="alert" className="text-muted-foreground">
                {LIST_ERROR}
              </p>
              <Button type="button" variant="outline" className="mt-4 min-h-11 w-full sm:w-auto" onClick={reload}>
                Try again
              </Button>
            </section>
          ) : current === null ? (
            <section className="rounded-2xl bg-card p-4 sm:p-6 md:p-8 lg:col-span-2">
              <p className="text-muted-foreground">No cases are awaiting review.</p>
            </section>
          ) : (
            <>
              <section className="flex flex-col gap-6 rounded-2xl bg-card p-4 sm:p-6 md:p-8">
                <div className="flex flex-col gap-2">
                  <h2 className="text-balance text-2xl font-semibold sm:text-3xl">{caseTitle(current)}</h2>
                  <p className="text-sm text-muted-foreground">Draft</p>
                </div>

                <div className="overflow-hidden rounded-xl border border-border">
                  {current.photoUrl === null ? (
                    <div className="flex aspect-[16/10] w-full items-center justify-center bg-muted sm:aspect-[16/5]">
                      <span className="text-sm text-muted-foreground">Photo unavailable</span>
                    </div>
                  ) : (
                    <>
                      <img
                        src={current.photoUrl}
                        alt="Food photo submitted for screening"
                        className="aspect-[16/10] w-full object-cover sm:aspect-[16/5]"
                      />
                      <a
                        href={current.photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-foreground px-4 py-3 text-left text-sm text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        Food photo · Open full image
                      </a>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold text-foreground">AI notes</h3>
                  <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                    <p>Verdict: REVIEW</p>
                    <p>Reason: {reasonText(current.notes, current.signs)}</p>
                    <p>Confidence: {confidenceLabel(current.confidence)}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {current.checklist === null ? (
                    <>
                      <p>Donor checklist: Not started</p>
                      <p>The checklist becomes available after this photo is screened.</p>
                    </>
                  ) : (
                    checklistLines(current.checklist).map((line) => <p key={line}>{line}</p>)
                  )}
                </div>
              </section>

              <aside className="flex flex-col gap-6 rounded-2xl bg-success p-4 sm:p-6 md:p-8">
                <h2 className="text-balance text-2xl font-semibold text-primary sm:text-3xl">Review carefully</h2>
                <div className="flex flex-col gap-4 text-sm text-muted-foreground sm:text-body">
                  <p>AI does not certify food safety. Review the visible condition of the food.</p>
                  <p>Pass allows the donor to continue the checklist. Reject ends this draft with a reason.</p>
                  <p>The volunteer still performs a separate inspection at pickup.</p>
                </div>
                {decisionError === null ? null : (
                  <p role="alert" className="rounded-lg bg-error p-4 text-sm text-foreground">
                    {decisionError}
                  </p>
                )}
                {gone ? (
                  <div role="alert" className="rounded-lg bg-error p-4 text-sm text-foreground">
                    <p>This case was already decided or is no longer pending.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4 min-h-11 w-full sm:w-auto"
                      onClick={() => {
                        setDecisionError(null);
                        setPinned(cases[0] ?? null);
                      }}
                    >
                      Show next case
                    </Button>
                  </div>
                ) : null}
                <div className="mt-auto flex flex-col gap-3 pt-4 sm:pt-8">
                  <Button type="button" className="min-h-11 w-full sm:w-60" onClick={() => void submitDecision(current, passBody())} disabled={busy || gone}>
                    Pass photo
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11 w-full sm:w-60" onClick={openReject} disabled={busy || gone}>
                    Reject with reason
                  </Button>
                </div>
              </aside>
            </>
          )}
        </div>

        <p className="rounded-xl bg-warning px-4 py-4 text-sm text-warning-foreground sm:px-6 sm:py-5">
          A timeout, malformed AI response, or low confidence also produces REVIEW rather than an automatic pass.
        </p>

        <Dialog
          open={rejectOpen}
          onOpenChange={(open) => {
            if (!open && busy) return;
            setRejectOpen(open);
            if (!open) {
              setReason("");
              setReasonError(null);
            }
          }}
        >
          <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Reject photo</DialogTitle>
              <DialogDescription>
                Give a reason for rejecting this photo. It is required and is saved with the decision.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="screening-reject-reason">Reason</Label>
              <Textarea
                id="screening-reject-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
                aria-invalid={reasonError !== null}
                aria-describedby={reasonError === null ? undefined : "screening-reject-reason-error"}
              />
              {reasonError === null ? null : (
                <p id="screening-reject-reason-error" role="alert" className="text-sm text-destructive">
                  {reasonError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => setRejectOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" className="min-h-11 w-full sm:w-auto" onClick={confirmReject} disabled={busy}>
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
