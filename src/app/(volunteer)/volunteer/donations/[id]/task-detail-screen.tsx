"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Skeleton } from "@/components/shared/skeleton";
import { REQUEST_TIMEOUT_MS, msUntilNextDay } from "@/app/(volunteer)/volunteer/assigned-tasks-logic";
import {
  parseChecklist,
  parseTaskDetail,
  type ChecklistState,
  type TaskDetail,
} from "./inspection/pickup-inspection-logic";
import {
  buildSafetyLines,
  buildTaskView,
  checklistPath,
  taskDetailPath,
  taskLoadFailure,
} from "./task-detail-logic";
import { TaskDetailView, type SafetyState } from "./task-detail-view";

type TaskState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "session" }
  | { kind: "error" }
  | { kind: "ready"; task: TaskDetail };

/** The checklist is only asked for while the task is ASSIGNED, so hidden is its own state. */
type ChecklistScreenState = { kind: "hidden" } | ChecklistState;

/** An answer remembers the route it was read for, so a new id never shows an old task. */
type Loaded<T> = { base: string; state: T };

function currentTask(base: string, loaded: Loaded<TaskState>): TaskState {
  return loaded.base === base ? loaded.state : { kind: "loading" };
}

function currentChecklist(base: string, loaded: Loaded<ChecklistScreenState>): ChecklistScreenState {
  return loaded.base === base ? loaded.state : { kind: "hidden" };
}

/** The task itself; 404 means unknown, malformed id or not one of this volunteer's tasks. */
async function loadTask(url: string): Promise<TaskState> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const failure = taskLoadFailure(response.status);
      if (failure === "notFound") return { kind: "notFound" };
      if (failure === "session") return { kind: "session" };
      return { kind: "error" };
    }
    const task = parseTaskDetail((await response.json()) as unknown);
    return task === null ? { kind: "error" } : { kind: "ready", task };
  } catch {
    return { kind: "error" };
  }
}

/** Any refusal or unreadable answer keeps the rest of the page alive with an error line. */
async function loadChecklist(url: string): Promise<ChecklistState> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "error" };
    const checklist = parseChecklist((await response.json()) as unknown);
    return checklist === null ? { kind: "error" } : { kind: "ready", checklist };
  } catch {
    return { kind: "error" };
  }
}

/** Placeholder blocks in the title, card and button positions. */
function TaskDetailSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading task…</span>
      <Skeleton className="h-10 w-3/4" />
      <Skeleton className="mt-3 h-4 w-1/2" />
      <div className="mt-6 rounded-lg bg-card p-5">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-3 h-4 w-5/6" />
        <Skeleton className="mt-5 h-4 w-4/5" />
        <Skeleton className="mt-3 h-4 w-3/4" />
      </div>
      <Skeleton className="mt-4 h-[52px] w-full" />
    </div>
  );
}

function safetyState(checklist: ChecklistScreenState, now: Date): SafetyState {
  if (checklist.kind === "hidden") return { kind: "hidden" };
  if (checklist.kind === "loading") return { kind: "loading" };
  if (checklist.kind === "error") return { kind: "error" };
  return { kind: "lines", lines: buildSafetyLines(checklist.checklist, now) };
}

export function TaskDetailScreen({ donationId }: { donationId: string }) {
  const base = taskDetailPath(donationId);

  const [task, setTask] = useState<Loaded<TaskState>>({ base, state: { kind: "loading" } });
  const [checklist, setChecklist] = useState<Loaded<ChecklistScreenState>>({
    base,
    state: { kind: "hidden" },
  });
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Re-render when the local calendar day changes, so the dates in the safety text stay right.
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), msUntilNextDay(now));
    return () => clearTimeout(timer);
  }, [now]);

  // Only the newest load may write; StrictMode's second mount reads again but wins nothing.
  const loadRun = useRef(0);

  // Mount, a new id and Try again all read here; a stale answer writes nothing.
  useEffect(() => {
    loadRun.current += 1;
    const mine = loadRun.current;

    void loadTask(base).then((result) => {
      if (loadRun.current !== mine) return;
      setTask({ base, state: result });
      // The checklist route answers 404 for every status but ASSIGNED, so it is not asked.
      if (result.kind !== "ready" || result.task.status !== "ASSIGNED") return;
      setChecklist({ base, state: { kind: "loading" } });
      void loadChecklist(checklistPath(donationId)).then((state) => {
        if (loadRun.current !== mine) return;
        setChecklist({ base, state });
      });
    });

    const runs = loadRun;
    return () => {
      // A late answer from an earlier id or after leaving the page is dropped.
      runs.current += 1;
    };
  }, [base, donationId, refresh]);

  const current = currentTask(base, task);
  let body: ReactNode;
  if (current.kind === "loading") {
    body = <TaskDetailSkeleton />;
  } else if (current.kind === "notFound") {
    body = (
      <FeedbackBanner
        tone="error"
        title="Task not found"
        action={{ label: "Back to your tasks", href: "/volunteer" }}
      />
    );
  } else if (current.kind === "session") {
    body = (
      <FeedbackBanner tone="error" title="Could not load this task">
        Your session may have ended, or this account cannot view volunteer tasks. Sign out and
        sign in again with your volunteer account.
      </FeedbackBanner>
    );
  } else if (current.kind === "error") {
    body = (
      <FeedbackBanner
        tone="error"
        title="Could not load this task"
        action={{
          label: "Try again",
          onClick: () => {
            setTask({ base, state: { kind: "loading" } });
            setRefresh((value) => value + 1);
          },
        }}
      >
        Check your connection and try again.
      </FeedbackBanner>
    );
  } else {
    body = (
      <TaskDetailView
        view={buildTaskView(current.task)}
        safety={safetyState(currentChecklist(base, checklist), now)}
      />
    );
  }

  return <div className="mx-auto w-full max-w-md">{body}</div>;
}
