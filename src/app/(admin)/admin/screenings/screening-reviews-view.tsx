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

// The signed photo URL lives 300 s (DEFAULT_SIGNED_URL_SECONDS), so the queue is
// re-read on this cadence before the "Open full image" link expires.
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
  // The case under review: a queue arrival pins the first case only while nothing
  // is pinned, and the Admin's own decision moves the pin to the next case.
  const [pinned, setPinned] = useState<ScreeningCase | null>(null);
  // A quiet re-read that fails keeps the queue on screen, but its photo links age out.
  const [refreshFailed, setRefreshFailed] = useState(false);
  const loadSeq = useRef(0);
  // The newest queue as it arrived: an own decision is computed from this ref,
  // never from the list captured when the click happened.
  const latestQueue = useRef<ScreeningCase[]>([]);

  // Fetching and applying are separate: the mount effect only passes applyCases
  // as a callback, so it never calls setState synchronously (react-hooks/set-state-in-effect).
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
    // The ref keeps the newest queue for a later own decision, written before
    // setLoad so no click can read a snapshot older than the screen.
    latestQueue.current = cases;
    // A queue arrival clears a refresh notice and pins the first case, but only
    // while nothing is pinned: the case under review never moves on its own.
    // The functional update keeps `pinned` out of the deps, so the mount effect
    // and the refresh interval keep their stable callbacks.
    setPinned((held) => held ?? cases[0] ?? null);
    setRefreshFailed(false);
    setLoad({ status: "ready", cases });
  }, []);

  /** Only the newest request may apply its result; older ones are dropped. */
  const loadLatest = useCallback(async (): Promise<{
    isStale: () => boolean;
    cases: ScreeningCase[] | null;
  }> => {
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

  /** Full reload through the loading state; from the click handler only. */
  function reload() {
    setLoad({ status: "loading" });
    void loadLatest().then((r) => {
      if (!r.isStale()) applyCases(r.cases);
    });
  }

  /** Quiet refill: the current queue stays on screen until the new one lands. */
  const refill = useCallback(() => {
    void loadLatest().then((r) => {
      if (r.isStale()) return;
      if (r.cases !== null) {
        applyCases(r.cases);
        return;
      }
      // Only a reload still waiting for its first answer becomes the load error:
      // a ready queue is never taken over here, so a retained pinned case stays
      // on screen (showQueueError decides for an empty one). The queue that
      // stays says so, because its photo links age out.
      setRefreshFailed(true);
      setLoad((state) => (state.status === "loading" ? { status: "error" } : state));
    });
  }, [loadLatest, applyCases]);

  // Keep the signed photo URL fresh: re-read the queue on a timer (skipped while the
  // tab is hidden) and again when it becomes visible, without any loading state.
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

  /**
   * The Admin's own decision, from the newest queue only: the decided case is
   * dropped, the rest stays on screen and its first case becomes the pin, so a
   * refill that landed while the POST was in flight cannot be shadowed by the
   * click-time snapshot.
   */
  function applyOwnDecision(screeningId: string) {
    const next = latestQueue.current.filter((c) => c.screeningId !== screeningId);
    latestQueue.current = next;
    // The load update is functional and the pin is set beside it: no state
    // setter is ever called inside another setter's updater.
    setLoad((state) => (state.status === "ready" ? { status: "ready", cases: next } : state));
    setPinned(nextAfterDecision(latestQueue.current, screeningId));
  }

  const cases = load.status === "ready" ? load.cases : EMPTY_CASES;
  // The screen shows the pinned case, refreshed from the latest queue when it is
  // still pending and held as it is (gone) when the queue no longer has it.
  const { current, gone } = reconcileActive(pinned, cases);
  // An emptied queue with a retained case stays on screen; only an empty queue
  // with no case and a failed refresh falls back to the load error.
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
        // Refill the queue (the route returns at most 100).
        refill();
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        return;
      }
      const errorBody: unknown = await response.json().catch(() => null);
      const failure = decisionMessage(response.status, errorBody);
      if (failure.refill || body.decision === "PASS") {
        // 404/409 mean the queue is stale: close the dialog so a second click cannot hit another case.
        setDecisionError(failure.message);
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        if (failure.refill) refill();
      } else {
        // A failed reject keeps the dialog open and shows the message inside it.
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
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-semibold tracking-wide text-(--fl-primary)">
            Workspace / Screening reviews
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">Screening reviews</h1>
          <p className="text-(--fl-muted)">
            Only REVIEW verdicts enter this queue. FLAG verdicts are rejected automatically.
          </p>
        </header>

        {load.status === "ready" && !showError ? (
          <p className="font-semibold text-[#885B16]">{countLabel(cases.length)}</p>
        ) : null}

        {load.status === "ready" && refreshFailed && !showError ? (
          <div
            role="status"
            className="flex items-center justify-between gap-4 rounded-xl bg-(--fl-warning) px-4 py-3 text-sm text-[#885B16]"
          >
            <p>The queue could not be refreshed, so photo links may have expired.</p>
            <Button type="button" variant="outline" onClick={refill}>
              Refresh now
            </Button>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,3fr)]">
          {load.status === "loading" ? (
            <section aria-busy="true" className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:col-span-2">
              <p className="text-(--fl-muted)">Loading cases…</p>
            </section>
          ) : showError ? (
            <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:col-span-2">
              <p role="alert" className="text-(--fl-muted)">
                {LIST_ERROR}
              </p>
              <Button type="button" variant="outline" className="mt-4" onClick={reload}>
                Try again
              </Button>
            </section>
          ) : current === null ? (
            <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:col-span-2">
              <p className="text-(--fl-muted)">No cases are awaiting review.</p>
            </section>
          ) : (
            <>
              <section className="flex flex-col gap-6 rounded-2xl bg-(--fl-card) p-6 sm:p-8">
                <div className="flex flex-col gap-2">
                  <h2 className="text-2xl font-bold sm:text-3xl">{caseTitle(current)}</h2>
                  <p className="text-sm text-(--fl-muted)">Draft</p>
                </div>

                <div className="overflow-hidden rounded-xl">
                  {current.photoUrl === null ? (
                    <div className="flex aspect-[16/5] w-full items-center justify-center bg-(--fl-muted)/30">
                      <span className="text-sm text-(--fl-muted)">Photo unavailable</span>
                    </div>
                  ) : (
                    <>
                      {/* The signed URL is rendered straight from the queue response: never logged or persisted. */}
                      <img
                        src={current.photoUrl}
                        alt="Food photo submitted for screening"
                        className="aspect-[16/5] w-full object-cover"
                      />
                      <a
                        href={current.photoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full bg-(--fl-ink) px-4 py-2 text-left text-sm text-white"
                      >
                        Food photo · Open full image
                      </a>
                    </>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-bold">AI notes</h3>
                  <div className="flex flex-col gap-1 text-sm text-(--fl-muted)">
                    <p>Verdict: REVIEW</p>
                    <p>Reason: {reasonText(current.notes, current.signs)}</p>
                    <p>Confidence: {confidenceLabel(current.confidence)}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-sm text-(--fl-muted)">
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

              <aside className="flex flex-col gap-6 rounded-2xl bg-(--fl-success) p-6 sm:p-8">
                <h2 className="text-2xl font-bold text-(--fl-primary) sm:text-3xl">Review carefully</h2>
                <div className="flex flex-col gap-5 text-(--fl-muted)">
                  <p>AI does not certify food safety. Review the visible condition of the food.</p>
                  <p>Pass allows the donor to continue the checklist. Reject ends this draft with a reason.</p>
                  <p>The volunteer still performs a separate inspection at pickup.</p>
                </div>
                {decisionError === null ? null : (
                  <p role="alert" className="rounded-lg bg-(--fl-error) p-4 text-sm text-(--fl-ink)">
                    {decisionError}
                  </p>
                )}
                {gone ? (
                  <div
                    role="alert"
                    className="rounded-lg bg-(--fl-error) p-4 text-sm text-(--fl-ink)"
                  >
                    <p>This case was already decided or is no longer pending.</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setDecisionError(null);
                        setPinned(cases[0] ?? null);
                      }}
                    >
                      Show next case
                    </Button>
                  </div>
                ) : null}
                <div className="mt-auto flex flex-col gap-3 pt-8">
                  <Button
                    type="button"
                    className="h-11 w-full sm:w-60"
                    onClick={() => void submitDecision(current, passBody())}
                    disabled={busy || gone}
                  >
                    Pass photo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 w-full sm:w-60"
                    onClick={openReject}
                    disabled={busy || gone}
                  >
                    Reject with reason
                  </Button>
                </div>
              </aside>
            </>
          )}
        </div>

        <p className="rounded-xl bg-(--fl-warning) px-6 py-5 text-sm text-[#885B16]">
          A timeout, malformed AI response, or low confidence also produces REVIEW rather than an
          automatic pass.
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
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject photo</DialogTitle>
              <DialogDescription>
                Give a reason for rejecting this photo. It is required and is saved with the
                decision.
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
              <Button
                type="button"
                variant="outline"
                onClick={() => setRejectOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="button" onClick={confirmReject} disabled={busy}>
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </main>
  );
}
