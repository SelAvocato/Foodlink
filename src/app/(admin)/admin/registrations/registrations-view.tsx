"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  GENERIC_ERROR,
  REGISTRATIONS_TABS,
  filterByTab,
  formatConsent,
  joinAddress,
  parseApplicants,
  proofCardTitle,
  readSignedUrl,
  relativeDayLabel,
  reviewMessage,
  tabCounts,
  typeLabel,
  validateReason,
  type Applicant,
  type RegistrationsTab,
} from "./registrations-logic";

const EMPTY_APPLICANTS: Applicant[] = [];

const TAB_LABELS: Record<RegistrationsTab, string> = {
  pending: "Pending",
  donors: "Donors",
  volunteers: "Volunteers",
};

const LIST_ERROR = "The applications could not be loaded.";
const PROOF_ERROR = "The proof document could not be opened.";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; applicants: Applicant[] };

type ReviewBody = { action: "APPROVE" } | { action: "REJECT"; reason: string };

export function RegistrationsView() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [tab, setTab] = useState<RegistrationsTab>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofBusy, setProofBusy] = useState(false);

  // Fetching and applying are separate: the mount effect only passes applyApplicants
  // as a callback, so it never calls setState synchronously (react-hooks/set-state-in-effect).
  const loadApplicants = useCallback(async (): Promise<Applicant[] | null> => {
    try {
      // No query: the route defaults to PENDING with limit 50.
      const response = await fetch("/api/admin/users");
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return parseApplicants(body);
    } catch {
      return null;
    }
  }, []);

  const applyApplicants = useCallback((applicants: Applicant[] | null) => {
    setLoad(applicants === null ? { status: "error" } : { status: "ready", applicants });
  }, []);

  /** Only the newest request may apply its result; older ones are dropped. */
  const loadLatest = useCallback(async (): Promise<{ isStale: () => boolean; applicants: Applicant[] | null }> => {
    loadSeq.current += 1;
    const mine = loadSeq.current;
    const applicants = await loadApplicants();
    return { isStale: () => mine !== loadSeq.current, applicants };
  }, [loadApplicants]);

  useEffect(() => {
    void loadLatest().then((r) => {
      if (!r.isStale()) applyApplicants(r.applicants);
    });
  }, [loadLatest, applyApplicants]);

  /** Full reload through the loading state; from click handlers only. */
  function reload() {
    setLoad({ status: "loading" });
    void loadLatest().then((r) => {
      if (!r.isStale()) applyApplicants(r.applicants);
    });
  }

  const applicants = load.status === "ready" ? load.applicants : EMPTY_APPLICANTS;
  const visible = useMemo(() => filterByTab(applicants, tab), [applicants, tab]);
  const counts = tabCounts(applicants);
  const selected = visible.find((a) => a.id === selectedId) ?? visible[0] ?? null;
  const now = new Date();

  /** Switching tabs makes the old selection disappear, so the first applicant wins. */
  function chooseTab(next: RegistrationsTab) {
    setTab(next);
    setSelectedId(filterByTab(applicants, next)[0]?.id ?? null);
    setReviewError(null);
    setProofError(null);
  }

  function select(id: string) {
    setSelectedId(id);
    setReviewError(null);
    setProofError(null);
  }

  function removeApplicant(applicant: Applicant) {
    const index = visible.findIndex((a) => a.id === applicant.id);
    // The one after it, else the one before it, else nothing left to select.
    const next = index === -1 ? null : (visible[index + 1] ?? visible[index - 1] ?? null);
    setSelectedId(next?.id ?? null);
    setProofError(null);
    setLoad((current) =>
      current.status === "ready"
        ? { status: "ready", applicants: current.applicants.filter((a) => a.id !== applicant.id) }
        : current,
    );
  }

  async function submitReview(applicant: Applicant, body: ReviewBody) {
    if (busy) return;
    setBusy(true);
    setReviewError(null);
    try {
      const response = await fetch(`/api/admin/users/${applicant.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        removeApplicant(applicant);
        // Refill the queue (the route returns at most 50); a failed re-read keeps the current list.
        void loadLatest().then((r) => {
          if (r.isStale()) return;
          if (r.applicants !== null) applyApplicants(r.applicants);
          // A failed refill must not leave a reload stuck on "Loading"; a good list stays.
          else setLoad((current) => (current.status === "loading" ? { status: "error" } : current));
        });
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        return;
      }
      const errorBody: unknown = await response.json().catch(() => null);
      const failure = reviewMessage(response.status, errorBody);
      if (failure.reload || body.action === "APPROVE") {
        // 404/409 mean the list is stale: close the dialog so a second click cannot hit another applicant.
        setReviewError(failure.message);
        setRejectOpen(false);
        setReason("");
        setReasonError(null);
        if (failure.reload) reload();
      } else {
        // A failed reject keeps the dialog open and shows the message inside it.
        setReasonError(failure.message);
      }
    } catch {
      if (body.action === "REJECT") setReasonError(GENERIC_ERROR);
      else setReviewError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  async function openProof() {
    if (selected === null || proofBusy) return;
    const documents = selected.documents;
    const proof = documents.length > 0 ? documents[0] : null;
    if (proof === null) return;
    // The blank tab must open inside the click handler or the popup blocker stops it.
    const blank = window.open("", "_blank");
    if (blank === null) {
      setProofError(PROOF_ERROR);
      return;
    }
    setProofError(null);
    setProofBusy(true);
    try {
      const response = await fetch(
        `/api/admin/users/${selected.id}/documents/${proof.id}/signed-url`,
      );
      if (!response.ok) throw new Error("proof request failed");
      const body: unknown = await response.json();
      const url = readSignedUrl(body);
      if (url === null) throw new Error("proof response had no url");
      // Handed straight to the tab: never kept in state, never logged, never shown.
      blank.location.href = url;
    } catch {
      blank.close();
      setProofError(PROOF_ERROR);
    } finally {
      setProofBusy(false);
    }
  }

  function openReject() {
    if (selected === null) return;
    setReason("");
    setReasonError(null);
    setRejectTargetId(selected.id);
    setRejectOpen(true);
  }

  function confirmReject() {
    const target = applicants.find((a) => a.id === rejectTargetId) ?? null;
    if (target === null) {
      setRejectOpen(false);
      setReason("");
      return;
    }
    if (busy) return;
    const validation = validateReason(reason);
    if (!validation.ok) {
      setReasonError(validation.message);
      return;
    }
    setReasonError(null);
    void submitReview(target, { action: "REJECT", reason: validation.reason });
  }

  const proof =
    selected === null
      ? null
      : selected.documents.length > 0
        ? selected.documents[0]
        : null;

  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-6 py-8 sm:py-10">
        <p className="text-xs font-semibold tracking-wide text-(--fl-primary)">
          Workspace / Registration approvals
        </p>
        <h1 className="mt-6 text-3xl font-semibold sm:text-4xl">Registration approvals</h1>
        <p className="mt-3 text-(--fl-muted)">
          Review private proof documents before activating donor and volunteer accounts.
        </p>

        <nav aria-label="Application filters" className="mt-8 flex flex-wrap gap-x-8 gap-y-2">
          {REGISTRATIONS_TABS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={tab === key}
              onClick={() => chooseTab(key)}
              disabled={busy}
              className="text-base font-semibold text-(--fl-primary)"
            >
              {key === "pending" ? `${TAB_LABELS.pending} ${counts.pending}` : TAB_LABELS[key]}
            </button>
          ))}
        </nav>

        <div className="mt-8 grid gap-6 lg:grid-cols-[360px_1fr]">
          {load.status === "loading" ? (
            <section aria-busy="true" className="rounded-2xl bg-(--fl-card) p-6 lg:col-span-2">
              <p className="text-(--fl-muted)">Loading applications…</p>
            </section>
          ) : load.status === "error" ? (
            <section className="rounded-2xl bg-(--fl-card) p-6 lg:col-span-2">
              <p role="alert" className="text-(--fl-muted)">
                {LIST_ERROR}
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={reload}
              >
                Try again
              </Button>
            </section>
          ) : selected === null ? (
            <section className="rounded-2xl bg-(--fl-card) p-6 lg:col-span-2">
              <p className="text-(--fl-muted)">No pending applications.</p>
            </section>
          ) : (
            <>
              <section className="rounded-2xl bg-(--fl-card) p-3">
                <h2 className="sr-only">Applications</h2>
                <ul className="flex flex-col gap-1">
                  {visible.map((applicant) => (
                    <li key={applicant.id}>
                      <button
                        type="button"
                        aria-current={applicant.id === selected.id ? "true" : undefined}
                        onClick={() => select(applicant.id)}
                        disabled={busy}
                        className={`w-full rounded-xl px-4 py-6 text-left ${
                          applicant.id === selected.id
                            ? "bg-(--fl-success)"
                            : "hover:bg-(--fl-canvas)"
                        }`}
                      >
                        <span
                          className={`block text-lg font-semibold ${
                            applicant.id === selected.id ? "text-(--fl-primary)" : ""
                          }`}
                        >
                          {applicant.businessName ?? applicant.fullName}
                        </span>
                        <span className="mt-2 block text-sm text-(--fl-muted)">
                          {typeLabel(applicant.role, applicant.donorType)} ·{" "}
                          {relativeDayLabel(applicant.createdAt, now)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8">
                <h2 className="text-2xl font-semibold sm:text-3xl">
                  {selected.businessName ?? selected.fullName}
                </h2>
                <p className="mt-4 text-sm font-semibold text-[#885B16]">
                  {typeLabel(selected.role, selected.donorType)} · PENDING
                </p>

                <dl className="mt-8 flex flex-col gap-1 text-base">
                  <div>
                    <dt className="inline">Full name: </dt>
                    <dd className="inline">{selected.fullName}</dd>
                  </div>
                  <div>
                    <dt className="inline">Email: </dt>
                    <dd className="inline">{selected.email}</dd>
                  </div>
                  <div>
                    <dt className="inline">Address: </dt>
                    <dd className="inline">{joinAddress(selected.address)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Privacy consent recorded: </dt>
                    <dd className="inline">{formatConsent(selected.privacyConsentAt)}</dd>
                  </div>
                </dl>

                {proof === null ? null : (
                  <div className="mt-10 rounded-xl bg-(--fl-canvas) p-5">
                    <h3 className="text-lg font-semibold">{proofCardTitle(proof.type)}</h3>
                    <p className="mt-3 text-sm text-(--fl-muted)">
                      Private document · Available only to authorized admins
                    </p>
                    <Button
                      type="button"
                      variant="link"
                      className="mt-3 h-auto p-0 font-semibold"
                      onClick={() => void openProof()}
                      disabled={proofBusy}
                    >
                      Open proof document →
                    </Button>
                    {proofError === null ? null : (
                      <p
                        role="alert"
                        className="mt-3 rounded-lg bg-(--fl-error) p-3 text-sm text-(--fl-ink)"
                      >
                        {proofError}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-8 flex flex-col gap-1 text-sm text-(--fl-muted)">
                  <p>Approving enables login. No email is sent yet.</p>
                  <p>Rejecting requires a reason that is saved with the decision. No email is sent yet.</p>
                </div>

                {reviewError === null ? null : (
                  <p
                    role="alert"
                    className="mt-6 rounded-lg bg-(--fl-error) p-4 text-sm text-(--fl-ink)"
                  >
                    {reviewError}
                  </p>
                )}

                <div className="mt-10 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => void submitReview(selected, { action: "APPROVE" })}
                    disabled={busy}
                  >
                    Approve account
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    className="text-(--fl-primary)"
                    onClick={openReject}
                    disabled={busy}
                  >
                    Reject application
                  </Button>
                </div>
              </section>
            </>
          )}
        </div>

        <p className="mt-6 rounded-xl bg-(--fl-success) p-5 text-sm text-(--fl-primary)">
          Proof documents are private. A donor’s type becomes fixed after approval.
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
              <DialogTitle>Reject application</DialogTitle>
              <DialogDescription>
                Give a reason for rejecting this application. It is required and is saved with the
                decision. No email is sent yet.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="reject-reason">Reason</Label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(null);
                }}
                aria-invalid={reasonError !== null}
                aria-describedby={reasonError === null ? undefined : "reject-reason-error"}
              />
              {reasonError === null ? null : (
                <p id="reject-reason-error" role="alert" className="text-sm text-destructive">
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
