"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { mapRow, taskCode, type TaskItem } from "./assigned-tasks-logic";
import { cardLabel, mobileDateLine, portionsText } from "./assigned-tasks-mobile-logic";

const LABEL = "text-caption font-semibold uppercase tracking-wide text-[#885B16]";
const CARD_BUTTON = "mt-4 h-[52px] w-full rounded-sm text-base font-semibold";

/** Figma p44: the mobile body of the p23 list. The view owns loading, errors and the empty state. */
export function AssignedTasksMobile({
  tasks,
  now,
}: {
  tasks: readonly TaskItem[];
  now: Date;
}) {
  // Its own minute clock drives the countdown; the date line stays on the view's now,
  // so the existing midnight refresh still updates the calendar day.
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-display font-semibold text-foreground">Your assigned tasks</h1>
      <p className="mt-2 text-sm text-muted-foreground">{mobileDateLine(now)}</p>

      <div className="mt-6 flex items-center gap-6">
        <span
          aria-current="page"
          className="inline-flex min-h-11 items-center text-base font-semibold text-primary"
        >
          Active {tasks.length}
        </span>
        {/* KNOWN LIMIT: the list route returns no CLOSED rows yet, so History cannot open. */}
        <span
          aria-disabled="true"
          className="inline-flex min-h-11 cursor-not-allowed items-center text-base font-semibold text-muted-foreground opacity-60"
        >
          History
        </span>
      </div>

      <ul className="mt-6 space-y-5">
        {tasks.map((item) => {
          const row = mapRow(item);
          return (
            <li key={row.id} className="rounded-lg bg-card p-5">
              <p className={LABEL}>{cardLabel(item, clock)}</p>
              <h2 className="mt-2 text-heading font-semibold text-foreground">{row.food}</h2>
              <p className="mt-1 text-body text-muted-foreground">
                {taskCode(item.shortCode)} · {portionsText(item.portions)}
              </p>
              <p className="mt-3 text-body text-muted-foreground">{row.location}</p>
              <p className="mt-1 text-body text-muted-foreground">{row.window}</p>

              {item.status === "ASSIGNED" ? (
                <p className="mt-3 text-body text-muted-foreground">
                  Donor: {item.donorName} · {item.donorPhone}
                </p>
              ) : null}

              {row.viewTaskHref !== null ? (
                <Button asChild className={CARD_BUTTON}>
                  <Link href={row.viewTaskHref}>{row.action}</Link>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-caption text-muted-foreground">
        You only see tasks assigned to you.
      </p>
    </div>
  );
}
