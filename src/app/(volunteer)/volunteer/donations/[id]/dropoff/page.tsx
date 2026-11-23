"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { parseTaskDetail, type TaskDetail } from "../inspection/pickup-inspection-logic";
import { taskDetailPath, taskLoadFailure } from "../task-detail-logic";
import { DonationStatus } from "@/contracts/enums";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Skeleton } from "@/components/shared/skeleton";
import { DropoffScreen } from "./dropoff-screen";
import { volunteerTaskPagePath } from "./dropoff-logic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TaskState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "session" }
  | { kind: "error" }
  | { kind: "ready"; task: TaskDetail };

export default function DropoffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<TaskState>({ kind: "loading" });
  const runRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    params.then(({ id: parsedId }) => {
      if (cancelled) return;

      setId(parsedId);

      if (!UUID_PATTERN.test(parsedId)) {
        setState({ kind: "notFound" });
        return;
      }

      void fetch(taskDetailPath(parsedId), {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      })
        .then(async (response) => {
          if (cancelled || runRef.current !== 0) return;

          if (response.status === 404) {
            setState({ kind: "notFound" });
            return;
          }

          if (!response.ok) {
            const failure = taskLoadFailure(response.status);
            setState(
              failure === "notFound"
                ? { kind: "notFound" }
                : failure === "session"
                  ? { kind: "session" }
                  : { kind: "error" },
            );
            return;
          }

          const task = parseTaskDetail(await response.json().catch(() => null));
          if (cancelled || runRef.current !== 0) return;
          if (task === null) {
            setState({ kind: "error" });
            return;
          }

          setState({ kind: "ready", task });
        })
        .catch(() => {
          if (!cancelled && runRef.current === 0) {
            setState({ kind: "error" });
          }
        });
    });

    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (state.kind === "ready" && state.task.status !== DonationStatus.PICKED_UP) {
      void router.replace(volunteerTaskPagePath(state.task.donationId));
    }
  }, [state, router]);

  if (id === null || state.kind === "loading") {
    return (
      <div className="mx-auto w-full max-w-[390px] px-5 py-6">
        <h1 className="text-display font-semibold text-foreground">
          Drop-off & proof
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">#FL-0268 · Picked up</p>
        <Skeleton className="mt-6 h-10 w-3/4" />
        <button
          className="mt-4 h-[52px] w-full rounded-sm bg-[#176448] text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled
        >
          Scan drop-off QR
        </button>
      </div>
    );
  }

  if (state.kind === "notFound") {
    return (
      <div className="mx-auto w-full max-w-[390px] px-5 py-6">
        <FeedbackBanner
          tone="error"
          title="Task not found"
          action={{ label: "Back to your tasks", href: "/volunteer" }}
        >
          This donation is not one of your assigned tasks.
        </FeedbackBanner>
      </div>
    );
  }

  if (state.kind === "session") {
    return (
      <div className="mx-auto w-full max-w-[390px] px-5 py-6">
        <FeedbackBanner tone="error" title="Could not load this task">
          Your session may have ended, or this account cannot view volunteer tasks. Sign out and
          sign in again with your volunteer account.
        </FeedbackBanner>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="mx-auto w-full max-w-[390px] px-5 py-6">
        <FeedbackBanner
          tone="error"
          title="Could not load this task"
          action={{ label: "Try again", onClick: () => setState({ kind: "loading" }) }}
        >
          Check your connection and try again.
        </FeedbackBanner>
      </div>
    );
  }

  return <DropoffScreen task={state.task} />;
}
