"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import { Skeleton } from "@/components/shared/skeleton";
import {
  ACCEPTED_LIMIT,
  REQUEST_TIMEOUT_MS,
  VOLUNTEER_LIMIT,
  assignFailure,
  availabilityLine,
  detailFailure,
  donationCode,
  filterVolunteers,
  isAwaitingAssignment,
  parseAcceptedListResponse,
  parseDetailResponse,
  parseVolunteersResponse,
  type AcceptedRowView,
  type AssignmentsRoute,
  type DetailView,
  type VolunteerView,
} from "./assignments-logic";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; rows: AcceptedRowView[] };

type DetailState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; detail: DetailView };

type VolunteersState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; volunteers: VolunteerView[] };

type Banner = {
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
  action?: { label: string; onClick?: () => void; href?: string };
};

type DetailRead =
  | { kind: "ready"; detail: DetailView }
  | { kind: "not-found" }
  | { kind: "error" };

async function loadAcceptedList(): Promise<AcceptedRowView[] | null> {
  try {
    const response = await fetch(`/api/admin/donations/accepted?limit=${ACCEPTED_LIMIT}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseAcceptedListResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

async function loadDetail(donationId: string): Promise<DetailRead> {
  try {
    const response = await fetch(`/api/admin/donations/${encodeURIComponent(donationId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: detailFailure(response.status) };
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return { kind: detailFailure(null) };
    const report = (body as { report?: unknown }).report;
    const detail = parseDetailResponse(report);
    return detail === null ? { kind: detailFailure(null) } : { kind: "ready", detail };
  } catch {
    return { kind: detailFailure(null) };
  }
}

async function loadVolunteers(): Promise<VolunteerView[] | null> {
  try {
    const response = await fetch(`/api/admin/volunteers?limit=${VOLUNTEER_LIMIT}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return parseVolunteersResponse((await response.json()) as unknown);
  } catch {
    return null;
  }
}

export function AssignmentsView({ route }: { route: AssignmentsRoute }) {
  const router = useRouter();
  const isList = route.kind === "list";
  const donationId = route.kind === "detail" ? route.donationId : null;

  const [listState, setListState] = useState<ListState>({ status: "loading" });
  const [listRetry, setListRetry] = useState(0);
  const [detailState, setDetailState] = useState<DetailState>({ status: "loading" });
  const [detailRetry, setDetailRetry] = useState(0);
  const [volunteersState, setVolunteersState] = useState<VolunteersState>({ status: "loading" });
  const [volunteersRetry, setVolunteersRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const listRun = useRef(0);
  const detailRun = useRef(0);
  const volunteersRun = useRef(0);

  useEffect(() => {
    if (!isList) return;
    listRun.current += 1;
    const mine = listRun.current;
    void loadAcceptedList().then((rows) => {
      if (listRun.current !== mine) return;
      setListState(rows === null ? { status: "error" } : { status: "ready", rows });
    });
    const runs = listRun;
    return () => {
      runs.current += 1;
    };
  }, [isList, listRetry]);

  useEffect(() => {
    if (donationId === null) return;
    detailRun.current += 1;
    const mine = detailRun.current;
    void loadDetail(donationId).then((read) => {
      if (detailRun.current !== mine) return;
      setDetailState(
        read.kind === "ready" ? { status: "ready", detail: read.detail } : { status: read.kind },
      );
    });
    const runs = detailRun;
    return () => {
      runs.current += 1;
    };
  }, [donationId, detailRetry]);

  useEffect(() => {
    if (donationId === null) return;
    volunteersRun.current += 1;
    const mine = volunteersRun.current;
    void loadVolunteers().then((volunteers) => {
      if (volunteersRun.current !== mine) return;
      setVolunteersState(
        volunteers === null ? { status: "error" } : { status: "ready", volunteers },
      );
    });
    const runs = volunteersRun;
    return () => {
      runs.current += 1;
    };
  }, [donationId, volunteersRetry]);

  const ready = detailState.status === "ready" ? detailState.detail : null;
  const awaiting = ready !== null && isAwaitingAssignment(ready.status);
  const displayStatus = ready === null ? "" : assigned ? "ASSIGNED" : ready.status;
  const detailCode = donationId === null ? "" : donationCode(donationId);
  const volunteerRows = volunteersState.status === "ready" ? volunteersState.volunteers : [];
  const visible = filterVolunteers(volunteerRows, search);

  function retryList() {
    setListState({ status: "loading" });
    setListRetry((value) => value + 1);
  }

  function reloadDetail() {
    setSelectedId(null);
    setBanner(null);
    setDetailState({ status: "loading" });
    setDetailRetry((value) => value + 1);
  }

  function reloadVolunteers() {
    setSelectedId(null);
    setBanner(null);
    setVolunteersState({ status: "loading" });
    setVolunteersRetry((value) => value + 1);
  }

  async function assign() {
    if (donationId === null || selectedId === null || busy || assigned || !awaiting) return;
    setBusy(true);
    setBanner(null);
    try {
      const response = await fetch(
        `/api/admin/donations/${encodeURIComponent(donationId)}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volunteerId: selectedId }),
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.ok) {
        const chosen =
          volunteerRows.find((volunteer) => volunteer.volunteerId === selectedId) ?? null;
        setAssigned(true);
        setBanner({
          tone: "success",
          title: "Volunteer assigned",
          message:
            chosen === null
              ? "The volunteer was assigned to this donation."
              : `${chosen.fullName} was assigned to this donation.`,
          action: { label: "View donation queue", href: "/admin/donation-queue" },
        });
        return;
      }
      const failure = assignFailure(response.status);
      setBanner({
        tone: failure.tone,
        title: failure.title,
        message: failure.message,
        action:
          failure.action === "reload-detail"
            ? { label: "Reload", onClick: reloadDetail }
            : failure.action === "reload-volunteers"
              ? { label: "Reload volunteers", onClick: reloadVolunteers }
              : undefined,
      });
    } catch {
      const failure = assignFailure(0);
      setBanner({ tone: failure.tone, title: failure.title, message: failure.message });
    } finally {
      setBusy(false);
    }
  }

  if (route.kind === "not-found" || (route.kind === "detail" && detailState.status === "not-found")) {
    return (
      <div className="mx-auto w-full max-w-[1180px] space-y-4">
        <button
          type="button"
          onClick={() => router.push("/admin/assignments")}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to the list
        </button>
        <FeedbackBanner tone="error" title="Donation not found">
          We could not find this donation. It may have been removed.
        </FeedbackBanner>
      </div>
    );
  }

  if (route.kind === "list") {
    return (
      <div className="mx-auto w-full max-w-[1180px] space-y-6">
        <div>
          <h1 className="text-balance text-3xl font-semibold text-foreground">Assignments</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Accepted donations that still need a volunteer. Soonest pickup end first.
          </p>
        </div>
        <div className="rounded-2xl bg-card p-4 sm:p-6">
          {listState.status === "loading" ? (
            <DataTableSkeleton rows={5} columns={5} label="Loading assignments" />
          ) : listState.status === "error" ? (
            <FeedbackBanner
              tone="error"
              title="Could not load the assignments"
              action={{ label: "Try again", onClick: retryList }}
            >
              The accepted donations could not be loaded. Check your connection and try again.
            </FeedbackBanner>
          ) : listState.rows.length === 0 ? (
            <EmptyState
              title="No donation is waiting for a volunteer"
              description="Accepted donations that still need a volunteer will appear here."
              action={
                <Link
                  href="/admin/donation-queue"
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View donation queue
                </Link>
              }
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {listState.rows.map((row) => (
                  <article key={row.donationId} className="rounded-xl border border-border p-4">
                    <p className="font-semibold text-foreground">{row.foodName}</p>
                    <p className="text-sm text-muted-foreground">{row.code}</p>
                    <dl className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <div className="flex gap-2"><dt className="min-w-24 font-medium text-foreground">Donor</dt><dd>{row.donorName}</dd></div>
                      <div className="flex gap-2"><dt className="min-w-24 font-medium text-foreground">Portions</dt><dd>{row.portions}</dd></div>
                      <div className="flex gap-2"><dt className="min-w-24 font-medium text-foreground">Pickup ends</dt><dd>{row.pickupEnd}</dd></div>
                    </dl>
                    <Button
                      type="button"
                      onClick={() => router.push(`/admin/assignments?donation=${encodeURIComponent(row.donationId)}`)}
                      className="mt-4 min-h-11 w-full"
                    >
                      Assign
                    </Button>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Donation</th>
                      <th className="px-4 py-3 font-medium">Donor</th>
                      <th className="px-4 py-3 font-medium">Portions</th>
                      <th className="px-4 py-3 font-medium">Pickup ends</th>
                      <th className="px-4 py-3"><span className="sr-only">Action</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {listState.rows.map((row) => (
                      <tr key={row.donationId} className="border-t border-border text-foreground">
                        <td className="px-4 py-4">
                          <p className="font-semibold">{row.foodName}</p>
                          <p className="text-muted-foreground">{row.code}</p>
                        </td>
                        <td className="px-4 py-4 text-muted-foreground">{row.donorName}</td>
                        <td className="px-4 py-4 text-muted-foreground">{row.portions}</td>
                        <td className="px-4 py-4 text-muted-foreground">{row.pickupEnd}</td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            type="button"
                            onClick={() => router.push(`/admin/assignments?donation=${encodeURIComponent(row.donationId)}`)}
                            className="min-h-11"
                          >
                            Assign
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-6">
      <button
        type="button"
        onClick={() => router.push("/admin/assignments")}
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the list
      </button>
      <div>
        <h1 className="text-balance text-3xl font-semibold text-foreground">Assign a volunteer</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Accepted donation / {detailCode}
          {ready !== null ? <> · {ready.foodName} · {ready.portions} portions</> : null}
        </p>
      </div>

      {banner !== null ? (
        <FeedbackBanner tone={banner.tone} title={banner.title} action={banner.action}>
          {banner.message}
        </FeedbackBanner>
      ) : null}

      {detailState.status === "loading" ? (
        <div role="status" aria-busy="true" className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,9fr)]">
          <span className="sr-only">Loading donation...</span>
          <div aria-hidden className="flex flex-col gap-6 rounded-2xl bg-card p-4 sm:p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-5 w-1/3" />
          </div>
          <div aria-hidden className="flex flex-col gap-6 rounded-2xl bg-card p-4 sm:p-6">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      ) : detailState.status === "error" ? (
        <FeedbackBanner tone="error" title="Could not load this donation" action={{ label: "Try again", onClick: reloadDetail }}>
          The donation details could not be loaded. Check your connection and try again.
        </FeedbackBanner>
      ) : ready !== null ? (
        <>
          {ready.hasPickup ? (
            <div className="rounded-xl bg-warning px-4 py-4 text-sm text-warning-foreground sm:px-5">
              Pickup ends {ready.pickupEnd}. Assign an ACTIVE volunteer before the pickup deadline.
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,9fr)]">
            <section className="flex flex-col rounded-2xl bg-card p-4 sm:p-6">
              <h2 className="text-xl font-semibold text-foreground sm:text-2xl">{ready.foodName}</h2>
              <div className="mt-6 space-y-6 text-sm text-muted-foreground sm:text-body">
                <div><p>{ready.donorName}</p><p>{ready.portions} portions</p></div>
                <div><p className="break-words">{ready.address}</p><p>{ready.window}</p></div>
                <p>Status: {displayStatus}</p>
              </div>
              <p className="mt-8 text-sm text-muted-foreground">
                Assigning moves the donation to ASSIGNED. The volunteer is not notified yet.
              </p>
            </section>

            <section className="flex flex-col rounded-2xl bg-card p-4 sm:p-6">
              {!awaiting ? (
                <FeedbackBanner tone="neutral" title="Not waiting for a volunteer" action={{ label: "Back to the list", href: "/admin/assignments" }}>
                  This donation is not waiting for a volunteer. Its current status is {displayStatus}.
                </FeedbackBanner>
              ) : (
                <>
                  <h2 className="text-xl font-semibold text-foreground sm:text-2xl">Choose an active volunteer</h2>
                  {volunteersState.status === "loading" ? (
                    <div role="status" aria-busy="true" className="mt-6 flex flex-col gap-4">
                      <span className="sr-only">Loading volunteers...</span>
                      <Skeleton className="h-12 w-full" />
                      <Skeleton className="h-24 w-full" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ) : volunteersState.status === "error" ? (
                    <div className="mt-6">
                      <FeedbackBanner tone="error" title="Could not load volunteers" action={{ label: "Try again", onClick: reloadVolunteers }}>
                        The volunteer list could not be loaded. Check your connection and try again.
                      </FeedbackBanner>
                    </div>
                  ) : volunteerRows.length === 0 ? (
                    <div className="mt-6">
                      <EmptyState title="No active volunteer is available yet" description="Active volunteers will appear here." />
                    </div>
                  ) : (
                    <>
                      <input
                        type="search"
                        value={search}
                        disabled={busy || assigned}
                        onChange={(event) => {
                          const next = event.target.value;
                          setSearch(next);
                          if (
                            selectedId !== null &&
                            !filterVolunteers(volunteerRows, next).some((volunteer) => volunteer.volunteerId === selectedId)
                          ) {
                            setSelectedId(null);
                          }
                        }}
                        placeholder="Search volunteers by name"
                        aria-label="Search volunteers by name"
                        className="mt-6 min-h-11 w-full rounded-lg bg-muted px-4 text-sm text-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <div role="radiogroup" aria-label="Active volunteers" className="mt-6 flex flex-col gap-4">
                        {visible.map((volunteer) => {
                          const selected = volunteer.volunteerId === selectedId;
                          return (
                            <label
                              key={volunteer.volunteerId}
                              className={`block cursor-pointer rounded-lg border p-4 ${selected ? "border-primary bg-success" : "border-transparent bg-muted"}`}
                            >
                              <span className="flex items-center gap-3">
                                <input
                                  type="radio"
                                  name="volunteer"
                                  value={volunteer.volunteerId}
                                  checked={selected}
                                  disabled={busy || assigned}
                                  onChange={() => setSelectedId(volunteer.volunteerId)}
                                  className="size-4 accent-primary"
                                />
                                <span className={`text-base font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                                  {volunteer.fullName}
                                </span>
                              </span>
                              <span className="mt-3 block text-sm text-muted-foreground">
                                {availabilityLine(volunteer.availability)}
                              </span>
                            </label>
                          );
                        })}
                        {visible.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No active volunteer matches that name.</p>
                        ) : null}
                      </div>
                    </>
                  )}
                </>
              )}
              {awaiting ? (
                <div className="mt-8 pt-4 sm:pt-8">
                  <Button
                    type="button"
                    disabled={selectedId === null || busy || assigned || volunteersState.status !== "ready"}
                    onClick={() => void assign()}
                    className="min-h-11 w-full sm:w-auto sm:min-w-[210px]"
                  >
                    Assign volunteer
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
