"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import type { AllergenOption } from "./checklist-logic";
import { canSubmit, parsePostSuccess, postFailure, type PostFailure } from "./post-logic";
import { parsePhotoUrl } from "./resume-logic";
import { decideReview, type ReviewDecision } from "./review-load";
import { formatDateTime } from "./review-logic";
import { ReviewStep } from "./review-step";

type ReviewPanelProps = {
  donationId: string;
  categoryName: string;
  requiresPreparedTime: boolean;
  donorLabel: string;
  allergenOptions: AllergenOption[];
  /** The draft is missing a finished step: the wizard opens it. */
  onNeeds: (step: "checklist" | "details") => void;
  /** Back and "Edit details" both return to the details step. */
  onBack: () => void;
};

type ReadyDecision = Extract<ReviewDecision, { kind: "ready" }>;

// A lost answer may hide a post that went through; a retry would then say NOT_EDITABLE.
const UNSURE_FAILURE: PostFailure = {
  message: "We could not confirm the result. The donation may already be posted. Check your donations before trying again.",
  lines: [],
};

type PanelState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; decision: ReadyDecision; photoUrl: string | null };

/** One GET body; undefined on any failure, which the decision reads as "failed". */
async function readBody(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function ReviewPanel({
  donationId,
  categoryName,
  requiresPreparedTime,
  donorLabel,
  allergenOptions,
  onNeeds,
  onBack,
}: ReviewPanelProps) {
  const [state, setState] = useState<PanelState>({ status: "loading" });
  // A late answer from an earlier load (or after leaving the step) is dropped.
  const loadRunRef = useRef(0);
  const [confirmed, setConfirmed] = useState(false);
  const [posting, setPosting] = useState(false);
  const [failure, setFailure] = useState<PostFailure | null>(null);
  const [posted, setPosted] = useState<{ donationId: string; expiresAt: string } | null>(null);
  // A second click in the same tick cannot start a second post.
  const postingRef = useRef(false);
  // The latest onNeeds, so a new callback identity never restarts the load.
  const onNeedsRef = useRef(onNeeds);
  useEffect(() => {
    onNeedsRef.current = onNeeds;
  }, [onNeeds]);

  const load = useCallback(async () => {
    const base = `/api/donor/drafts/${donationId}`;
    const [draftsBody, checklistBody, pickupBody, photoBody] = await Promise.all([
      readBody("/api/donor/drafts"),
      readBody(`${base}/checklist`),
      readBody(`${base}/pickup`),
      readBody(`${base}/photo`),
    ]);
    const decision = decideReview({
      donationId,
      draftsBody,
      checklistBody,
      pickupBody,
      categoryName,
      requiresPreparedTime,
      donorLabel,
      allergenOptions,
    });
    return { decision, photoUrl: parsePhotoUrl(photoBody) };
  }, [donationId, categoryName, requiresPreparedTime, donorLabel, allergenOptions]);

  const run = useCallback(() => {
    loadRunRef.current += 1;
    const mine = loadRunRef.current;
    void load().then(({ decision, photoUrl }) => {
      if (loadRunRef.current !== mine) return;
      // A reload that lands while a post runs must not replace the screen.
      if (postingRef.current) return;
      if (decision.kind === "needs") {
        onNeedsRef.current(decision.step);
        return;
      }
      setState(
        decision.kind === "failed"
          ? { status: "failed" }
          : { status: "ready", decision, photoUrl },
      );
    });
  }, [load]);

  useEffect(() => {
    run();
    const runs = loadRunRef;
    return () => {
      runs.current += 1;
    };
  }, [run]);

  async function handleSubmit() {
    if (postingRef.current || !canSubmit({ confirmed, posting })) return;
    postingRef.current = true;
    setPosting(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/donor/drafts/${donationId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      let body: unknown = null;
      try {
        body = (await response.json()) as unknown;
      } catch {
        body = null;
      }
      if (response.ok) {
        const done = parsePostSuccess(body);
        if (done === null) {
          setFailure(UNSURE_FAILURE);
        } else {
          setPosted(done);
          window.history.replaceState(null, "", window.location.pathname);
          window.scrollTo({ top: 0 });
        }
      } else {
        setFailure(postFailure(body));
      }
    } catch {
      setFailure(UNSURE_FAILURE);
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  }

  function handleRetry() {
    setState({ status: "loading" });
    run();
  }

  if (posted !== null) {
    const expires = formatDateTime(posted.expiresAt);
    return (
      <FeedbackBanner tone="success" title="Donation posted">
        Your donation is now available to the organization.
        {expires === null ? "" : ` It expires on ${expires}.`}
      </FeedbackBanner>
    );
  }
  if (state.status === "loading") return <p>Loading your review…</p>;
  if (state.status === "failed") {
    return (
      <FeedbackBanner
        tone="error"
        title="Could not load your review"
        action={{ label: "Try again", onClick: handleRetry }}
      >
        Please try again.
      </FeedbackBanner>
    );
  }
  return (
    <ReviewStep
      foodName={state.decision.foodName}
      summary={state.decision.summary}
      safetyLines={state.decision.safetyLines}
      pickupLines={state.decision.pickupLines}
      photoUrl={state.photoUrl}
      onBack={onBack}
      onEdit={onBack}
      confirmed={confirmed}
      onConfirmedChange={setConfirmed}
      onSubmit={() => void handleSubmit()}
      submitDisabled={!canSubmit({ confirmed, posting })}
      posting={posting}
      error={failure}
    />
  );
}
