"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { PageHeader } from "@/components/shared/page-header";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import { FilterBar, FilterSelect, SearchInput } from "@/components/shared/filter-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableCellStrong,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shared/data-table";
import {
  PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
  bannerText,
  contactLine,
  emptyState,
  filterItems,
  loadFailure,
  mapRow,
  msUntilNextDay,
  parseTasksResponse,
  type LoadFailure,
  type TaskItem,
} from "./assigned-tasks-logic";
import { AssignedTasksMobile } from "./assigned-tasks-mobile";

type TasksState =
  | { status: "loading" }
  | { status: "error"; failure: LoadFailure }
  | { status: "ready"; items: TaskItem[] };

/** The list, or the kind of failure (network, timeout, status, wrong shape). */
async function loadTasks(): Promise<{ items: TaskItem[] } | { failure: LoadFailure }> {
  try {
    const response = await fetch(`/api/volunteer/donations?pageSize=${PAGE_SIZE}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { failure: loadFailure(response.status) };
    const items = parseTasksResponse((await response.json()) as unknown);
    return items === null ? { failure: "error" } : { items };
  } catch {
    return { failure: "error" };
  }
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
  { value: "picked-up", label: "Picked up" },
  { value: "delivered", label: "Delivered" },
];

const HEAD_LINE = "border-b border-[#DCE4DE]";

const PHONE_STEPS = [
  "Scan pickup",
  "Photo & inspection",
  "Drop-off proof",
  "Distribution records",
  "Complete",
];

const DATE_OPTIONS = [
  { value: "all", label: "All dates" },
  { value: "today", label: "Today" },
];

export function AssignedTasksView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [date, setDate] = useState("all");
  const [tasks, setTasks] = useState<TasksState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  // A late answer from an earlier request (or after leaving the page) is dropped.
  const loadRun = useRef(0);

  useEffect(() => {
    loadRun.current += 1;
    const mine = loadRun.current;
    void loadTasks().then((result) => {
      if (loadRun.current !== mine) return;
      setTasks(
        "items" in result
          ? { status: "ready", items: result.items }
          : { status: "error", failure: result.failure },
      );
    });
    const runs = loadRun;
    return () => {
      runs.current += 1;
    };
  }, [retry]);

  // "Today" follows the local calendar: refresh the clock just after local midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(() => setNow(new Date()), msUntilNextDay(now));
    return () => clearTimeout(timer);
  }, [now]);

  const items = tasks.status === "ready" ? tasks.items : [];
  const visible = filterItems(items, { search, status, date, now });
  const banner = tasks.status === "ready" ? bannerText(items) : null;
  const contact = tasks.status === "ready" ? contactLine(items) : null;

  function retryLoad() {
    setTasks({ status: "loading" });
    setRetry((value) => value + 1);
  }

  // Loading and the two error banners belong to both breakpoints; the table is desktop only.
  let stateNotice: ReactNode = null;
  if (tasks.status === "loading") {
    stateNotice = <DataTableSkeleton rows={5} columns={5} label="Loading tasks" />;
  } else if (tasks.status === "error" && tasks.failure === "session") {
    stateNotice = (
      <FeedbackBanner tone="error" title="Could not load your tasks">
        Your session may have ended, or this account cannot view volunteer tasks. Sign out and
        sign in again with your volunteer account.
      </FeedbackBanner>
    );
  } else if (tasks.status === "error") {
    stateNotice = (
      <FeedbackBanner
        tone="error"
        title="Could not load your tasks"
        action={{ label: "Try again", onClick: retryLoad }}
      >
        Check your connection and try again.
      </FeedbackBanner>
    );
  }

  let body: ReactNode;
  if (stateNotice !== null) {
    body = stateNotice;
  } else if (visible.length === 0) {
    const empty = emptyState(items.length > 0);
    body = <EmptyState title={empty.title} description={empty.description} />;
  } else {
    body = (
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD_LINE}>Donation</TableHead>
            <TableHead className={HEAD_LINE}>Pickup location</TableHead>
            <TableHead className={HEAD_LINE}>Pickup window</TableHead>
            <TableHead className={HEAD_LINE}>Status</TableHead>
            <TableHead className={HEAD_LINE}>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((item) => {
            const row = mapRow(item);
            return (
              <TableRow key={row.id} className="h-[72px]">
                <TableCellStrong>
                  {row.code} · {row.food}
                </TableCellStrong>
                <TableCell>{row.location}</TableCell>
                <TableCell>{row.window}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>
                  {row.viewTaskHref !== null ? (
                    <Link
                      href={row.viewTaskHref}
                      className="inline-flex items-center gap-1.5 rounded-sm text-[#176448] hover:text-[#12513a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176448]"
                    >
                      {row.action}
                      <ArrowRight className="size-4" strokeWidth={2.25} aria-hidden="true" />
                    </Link>
                  ) : (
                    <span
                      aria-disabled="true"
                      title="Available once the screen for this action exists"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 text-[#63746D] opacity-50"
                    >
                      {row.action}
                      <ArrowRight className="size-4" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    );
  }

  let mobileBody: ReactNode;
  if (stateNotice !== null) {
    mobileBody = stateNotice;
  } else if (items.length === 0) {
    const empty = emptyState(false);
    mobileBody = <EmptyState title={empty.title} description={empty.description} />;
  } else {
    mobileBody = <AssignedTasksMobile tasks={items} now={now} />;
  }

  return (
    <div className="-m-6 min-h-[calc(100vh-3.5rem)] bg-[#F5F7F5] p-6">
      <div className="mx-auto max-w-[1147px]">
        <div className="hidden space-y-8 md:block">
          <PageHeader
            title="Your assigned tasks"
            description="Only donations assigned to you appear here."
          />

          {banner !== null ? (
            <section className="rounded-xl bg-[#176448] px-7 py-8 text-white">
              <p className="text-3xl font-semibold">{banner.headline}</p>
              <p className="mt-4 text-base">
                {banner.awaiting} <span className="mx-3">·</span> {banner.reports}
              </p>
            </section>
          ) : null}

          <div>
            <div className="flex gap-6">
              <button
                type="button"
                aria-current="page"
                className="min-h-11 text-base font-semibold text-[#176448]"
              >
                Active
              </button>
              <button
                type="button"
                disabled
                title="History needs finished donations, which the list route does not return yet"
                className="min-h-11 cursor-not-allowed text-base font-semibold text-[#176448] opacity-40"
              >
                History
              </button>
            </div>

            <div className="mt-2 space-y-6">
              {/* Known limit, to fix after the demo (also in PROJECT_NOTES): search and the
                  Status and Date filters will only filter the rows already loaded in the
                  browser. The list route returns at most 50 per page and has no search or
                  date parameter. This is intentional for now. */}
              <FilterBar>
                <SearchInput
                  label="Search your tasks"
                  placeholder="Search your tasks by food name or ID"
                  value={search}
                  onChange={setSearch}
                />
                <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
                <FilterSelect label="Date" value={date} onChange={setDate} options={DATE_OPTIONS} />
              </FilterBar>

              <div className="rounded-xl bg-white px-6 pb-10 pt-4">{body}</div>
            </div>
          </div>

          {contact !== null ? (
            <p className="text-sm text-[#63746D]">{contact}</p>
          ) : null}

          <section className="rounded-xl bg-[#EAF4EE] px-7 py-6">
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lg font-medium text-[#176448]">
              <span>On your phone:</span>
              {PHONE_STEPS.map((step, index) => (
                <Fragment key={step}>
                  {index > 0 ? <ArrowRight className="size-[18px]" strokeWidth={2.25} aria-hidden="true" /> : null}
                  <span>{step}</span>
                </Fragment>
              ))}
            </p>
            <p className="mt-2 text-sm text-[#63746D]">
              Food can only leave the donor after your own inspection passes.
            </p>
          </section>
        </div>

        <div className="md:hidden">{mobileBody}</div>
      </div>
    </div>
  );
}
