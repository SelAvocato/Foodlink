"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { PageHeader } from "@/components/shared/page-header";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import {
  REQUEST_TIMEOUT_MS,
  buildListQuery,
  emptyState,
  mapRow,
  parseListResponse,
  type DonationListItemJson,
  type DonationListResponseJson,
} from "../donations/donations-logic";
import { greetingFor, pickupStrip, profileFirstName } from "./overview-logic";

const PAGE_SIZE = 5;
const LIST_QUERY = buildListQuery({
  tab: "active",
  search: "",
  status: "",
  page: 1,
  pageSize: PAGE_SIZE,
});
const HEADERS = ["Donation", "Portions", "Pickup window", "Status", "Action"];
const LOADING_VALUE = "—";
const EMPTY_ACTIVE = emptyState("active", false);
// Impact totals for this banner arrive with the Achievements feature; zeros until then.
const IMPACT = { portions: 0, people: 0 };

type Loaded = {
  /** null when the list request failed (network, timeout, status or wrong shape). */
  list: DonationListResponseJson | null;
  name: string | null;
  /** Read once when the load finishes, so the strip does not tick. */
  now: Date;
  /** Also read once then, so no Date call happens in render. */
  hour: number;
};

/** The list answer, or null on any failure. */
async function loadList(): Promise<DonationListResponseJson | null> {
  try {
    // The signal also covers the body read below.
    const response = await fetch(`/api/donor/donations?${LIST_QUERY}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseListResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

/** The donor's first name, or null on any failure: the greeting never fails the page. */
async function loadProfileName(): Promise<string | null> {
  try {
    const response = await fetch("/api/donor/profile", {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return profileFirstName((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export function OverviewView() {
  const [state, setState] = useState<Loaded | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([loadList(), loadProfileName()]).then(([list, name]) => {
      if (!active) return;
      // The browser clock is read here, once, never during render.
      const finishedAt = new Date();
      setState({ list, name, now: finishedAt, hour: finishedAt.getHours() });
    });
    return () => {
      active = false;
    };
  }, [retry]);

  const loading = state === null;
  const list = state?.list ?? null;
  const failed = !loading && list === null;
  const items: DonationListItemJson[] = list?.items ?? [];
  const rows = items.map((item) => mapRow(item));
  const strip = state === null || failed ? null : pickupStrip(items, state.now);

  const title =
    state === null
      ? "Welcome"
      : state.name === null
        ? greetingFor(state.hour)
        : `${greetingFor(state.hour)}, ${state.name}`;

  const counts = [
    { label: "Active donations", value: list === null ? LOADING_VALUE : list.counts.active },
    { label: "Saved draft", value: list === null ? LOADING_VALUE : list.counts.drafts },
    { label: "Completed", value: list === null ? LOADING_VALUE : list.counts.completed },
    { label: "Not completed", value: list === null ? LOADING_VALUE : list.counts.notCompleted },
  ];

  return (
    <div>
      <PageHeader
        title={title}
        description="Here’s the food you’re helping move today."
        actions={
          <Button asChild className="min-w-[210px] rounded-sm">
            <Link href="/donor/donate">
              <Plus aria-hidden className="size-4" />
              Donate food
            </Link>
          </Button>
        }
      />

      {failed ? null : (
        <section
          aria-label="Donation counts"
          className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
        >
          {counts.map((c) => (
            <div
              key={c.label}
              className="flex min-h-[133px] flex-col justify-between rounded-xl bg-card p-6"
            >
              <p className="text-body text-muted-foreground">{c.label}</p>
              <p className="mb-1 text-display font-semibold text-foreground">{c.value}</p>
            </div>
          ))}
        </section>
      )}

      <section
        aria-label="Your impact"
        className="mt-7 flex min-h-[142px] flex-col justify-between gap-6 rounded-2xl bg-[#176448] p-7 text-white lg:flex-row lg:items-start"
      >
        <div>
          <h2 className="text-2xl font-semibold">Small surplus. Meaningful impact.</h2>
          <p className="mt-5 text-sm text-white/90">From your completed donations</p>
        </div>
        <p className="text-2xl font-semibold lg:mr-24 lg:mt-3">
          {IMPACT.portions} portions
          <span aria-hidden className="mx-5">
            {"·"}
          </span>
          {IMPACT.people} people served
        </p>
      </section>

      <div className="mt-11 flex items-center justify-between">
        <h2 className="text-[22px] font-semibold text-foreground">Active donations</h2>
        <Link
          href="/donor/donations"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#176448] lg:mr-[88px]"
        >
          View all
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {loading ? (
        <div className="mt-5">
          <DataTableSkeleton columns={5} rows={5} label="Loading donations" />
        </div>
      ) : failed ? (
        <div className="mt-5">
          <FeedbackBanner
            tone="error"
            title="Could not load your donations"
            action={{ label: "Try again", onClick: () => setRetry((value) => value + 1) }}
          >
            Check your connection and try again.
          </FeedbackBanner>
        </div>
      ) : items.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title={EMPTY_ACTIVE.title}
            description={EMPTY_ACTIVE.description}
            action={
              <Link
                href="/donor/donate"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Donate food
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-2xl bg-card px-6 pb-10">
          <table className="w-full min-w-[820px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[12%]" />
              <col className="w-[24%]" />
              <col className="w-[16%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead>
              <tr className="h-[53px] border-b border-border text-muted-foreground">
                {HEADERS.map((h) => (
                  <th key={h} scope="col" className="pr-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="h-[69px] border-b border-border">
                  <td className="pr-4 font-medium text-foreground">
                    {row.code} {"·"} {row.name}
                  </td>
                  <td className="pr-4 text-muted-foreground">{row.portions}</td>
                  <td className="pr-4 text-muted-foreground">{row.pickup}</td>
                  <td className="pr-4 text-muted-foreground">{row.status}</td>
                  <td>
                    {row.action ? (
                      <Link
                        href={row.action.href}
                        className="inline-flex min-h-11 items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        View tracking
                        <ArrowRight aria-hidden className="size-4" />
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {strip !== null ? (
        <p
          role="status"
          className="mt-10 rounded-xl bg-[#FFF4DE] px-5 py-[22px] text-sm text-[#885B16]"
        >
          {strip}
        </p>
      ) : null}
    </div>
  );
}
