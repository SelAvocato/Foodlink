"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "next-auth/react";
import { Check } from "lucide-react";
import { Skeleton } from "@/components/shared/skeleton";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import type { DistributionSummary } from "@/contracts/distribution";
import type { DistributionEntryView } from "@/contracts/volunteer-distribution";

type EntriesBody = {
  summary: DistributionSummary;
  entries: DistributionEntryView[];
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; summary: DistributionSummary; entries: DistributionEntryView[] };

const LOAD_FAILED = "Could not load the completed donation";

/** The first word of the session name, or null when there is none to show. */
function firstName(fullName: string | null | undefined): string | null {
  if (fullName === null || fullName === undefined) return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first === "" ? null : first;
}

export function CompletedDistributionScreen({ donationId }: { donationId: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [volunteerName, setVolunteerName] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const run = useRef(0);

  const readUrl = `/api/donations/${encodeURIComponent(donationId)}/distribution-entries`;
  const listUrl = `/tasks/${encodeURIComponent(donationId)}/distribution`;

  useEffect(() => {
    let active = true;
    void getSession()
      .then((session) => {
        if (!active) return;
        setVolunteerName(firstName(session?.user?.name));
      })
      .catch(() => {
        if (!active) return;
        setVolunteerName(null);
      });
    return () => {
      active = false;
    };
  }, []);

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
        if (body.summary.status !== "CLOSED") {
          router.replace(listUrl);
          return;
        }
        setState({ kind: "ready", summary: body.summary, entries: body.entries });
      })
      .catch(() => {
        if (run.current !== mine) return;
        setState({ kind: "error", message: LOAD_FAILED });
      });
  }, [readUrl, listUrl, router, reloadToken]);

  const handleRetry = useCallback(() => {
    setState({ kind: "loading" });
    setReloadToken((current) => current + 1);
  }, []);

  const handleBack = useCallback(() => {
    router.replace("/volunteer");
  }, [router]);

  if (state.kind === "loading") {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">Loading the completed donation…</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-6 h-72 w-full rounded-2xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
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
  const peopleServed = entries.reduce(
    (total, entry) => total + entry.peopleServed,
    0,
  );

  return (
    <div className="space-y-5">
      <h1 className="text-display font-semibold text-foreground">
        Donation completed
      </h1>
      <p className="text-sm text-muted-foreground">
        {volunteerName === null
          ? "Thank you for seeing it through."
          : `Thank you for seeing it through, ${volunteerName}.`}
      </p>

      <div className="rounded-2xl bg-[#EAF4EE]/60 p-6">
        <Check aria-hidden className="size-10 text-[#176448]" />
        <p className="mt-6 text-2xl font-semibold text-[#176448]">
          Every portion has a record.
        </p>
        <div className="mt-4 space-y-1 text-sm text-[#63746D]">
          <p>{summary.referenceCode}</p>
          <p>{summary.distributedQuantity} portions distributed</p>
          <p>{summary.unusableQuantity} unusable portions recorded</p>
          <p>{peopleServed} people served</p>
        </div>
      </div>

      <p className="rounded-xl bg-[#EAF4EE]/60 p-4 text-sm text-[#63746D]">
        The donor has been notified.
      </p>

      <div className="space-y-3 pt-2">
        <button
          type="button"
          onClick={handleBack}
          className="w-full min-h-[48px] rounded-xl bg-[#1B6B46] px-4 py-3 text-base font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to assigned tasks
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="w-full min-h-[48px] rounded-xl border border-neutral-200 bg-white px-4 py-3 text-base font-semibold text-[#1B6B46] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          History &amp; achievements
          <span className="sr-only"> (coming soon)</span>
        </button>
      </div>
    </div>
  );
}
