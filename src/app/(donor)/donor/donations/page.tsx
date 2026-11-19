"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import type { DonorDonationTab, DonorDonationTabCounts } from "@/contracts/donor-donation-list";
import { DonationsView } from "./donations-view";
import {
  DEFAULT_PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
  SEARCH_DEBOUNCE_MS,
  buildListQuery,
  buildHighlights,
  buildTabs,
  emptyState,
  mapRow,
  pageCount,
  parseListResponse,
  parseTab,
  statusOptions,
  summaryText,
  type DonationListItemJson,
  type DonationListResponseJson,
} from "./donations-logic";

/** The answer for one request key; data is null when that request failed. */
type Result = { key: string; data: DonationListResponseJson | null };

/** The newest row of the Drafts and Not completed tabs; null when that read failed or is empty. */
type Cards = { draft: DonationListItemJson | null; notCompleted: DonationListItemJson | null };

/** The list answer, or null on any failure (network, timeout, status, wrong shape). */
async function loadList(query: string): Promise<DonationListResponseJson | null> {
  try {
    // The signal also covers the body read below.
    const response = await fetch(`/api/donor/donations?${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseListResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export default function DonationsPage() {
  const [tab, setTab] = useState<DonorDonationTab>("active");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [counts, setCounts] = useState<DonorDonationTabCounts | null>(null);
  const [cards, setCards] = useState<Cards | null>(null);
  // A late answer from an earlier request (or after leaving the page) is dropped.
  const loadRunRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardsRunRef = useRef(0);

  const query = buildListQuery({
    tab,
    search: appliedSearch,
    status,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });
  const key = `${retry}|${query}`;

  useEffect(() => {
    loadRunRef.current += 1;
    const mine = loadRunRef.current;
    void loadList(query).then((data) => {
      if (loadRunRef.current !== mine) return;
      setResult({ key, data });
      if (data !== null) setCounts(data.counts);
    });
    const runs = loadRunRef;
    return () => {
      runs.current += 1;
    };
  }, [key, query]);

  // The two cards read the newest row of one tab each; a failed read hides that card.
  useEffect(() => {
    cardsRunRef.current += 1;
    const mine = cardsRunRef.current;
    const newest = (cardTab: DonorDonationTab) =>
      loadList(buildListQuery({ tab: cardTab, search: "", status: "", page: 1, pageSize: 1 }));
    void Promise.all([newest("drafts"), newest("not_completed")]).then((answers) => {
      if (cardsRunRef.current !== mine) return;
      setCards({
        draft: answers[0]?.items[0] ?? null,
        notCompleted: answers[1]?.items[0] ?? null,
      });
    });
    const runs = cardsRunRef;
    return () => {
      runs.current += 1;
    };
  }, [retry]);

  useEffect(() => {
    const timers = searchTimerRef;
    return () => {
      if (timers.current !== null) clearTimeout(timers.current);
    };
  }, []);

  function handleTabChange(id: string) {
    const next = parseTab(id);
    if (next === null) return;
    setTab(next);
    setStatus("");
    setPage(1);
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setAppliedSearch(value);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    setPage(1);
  }

  // Only an answer for the current request counts; anything else is "loading".
  const current = result !== null && result.key === key ? result : null;
  const data = current?.data ?? null;
  const filtered = appliedSearch.trim() !== "" || status !== "";

  let body: ReactNode;
  if (current === null) {
    body = <DataTableSkeleton columns={5} rows={5} label="Loading donations" />;
  } else if (data === null) {
    body = (
      <FeedbackBanner
        tone="error"
        title="Could not load your donations"
        action={{ label: "Try again", onClick: () => setRetry((value) => value + 1) }}
      >
        Check your connection and try again.
      </FeedbackBanner>
    );
  }

  return (
    <DonationsView
      tabs={buildTabs(counts)}
      tab={tab}
      onTabChange={handleTabChange}
      search={search}
      onSearchChange={handleSearchChange}
      statusOptions={statusOptions(tab)}
      status={status}
      onStatusChange={handleStatusChange}
      rows={data === null ? [] : data.items.map((item) => mapRow(item))}
      empty={emptyState(tab, filtered)}
      summary={
        data === null
          ? ""
          : summaryText({
              tab,
              page: data.page,
              pageSize: data.pageSize,
              total: data.total,
              itemCount: data.items.length,
            })
      }
      page={page}
      pageCount={data === null ? 1 : pageCount(data.total, data.pageSize)}
      onPageChange={setPage}
      body={body}
      highlights={cards === null ? undefined : buildHighlights(cards.draft, cards.notCompleted)}
    />
  );
}
