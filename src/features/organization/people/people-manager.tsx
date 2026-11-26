"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import type {
  AdminPeopleListResponse,
  AdminPeopleRole,
  AdminPeopleStatus,
  AdminPeopleType,
} from "@/contracts/admin-people";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableCellStrong,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shared/data-table";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { FilterBar, FilterSelect, SearchInput } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { TabBar } from "@/components/shared/tab-bar";
import { Button } from "@/components/ui/button";
import { listPeople, reactivateAccount, suspendAccount } from "./people-client";
import {
  buildPeopleQuery,
  DEFAULT_PAGE_SIZE,
  DEBOUNCE_MS,
  donorTypeLabel,
  pageCount,
  rangeSummary,
  REQUEST_TIMEOUT_MS,
  roleLabel,
  statusLabel,
  validateSuspendReason,
} from "./people-logic";
import type { Person } from "./types";

type Dialog = null | "suspend" | "reactivate";

export function PeopleManager() {
  const [role, setRole] = useState<AdminPeopleRole>("DONOR");
  const [status, setStatus] = useState<AdminPeopleStatus | "ALL">("ALL");
  const [type, setType] = useState<AdminPeopleType>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminPeopleListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(
    () => buildPeopleQuery({ role, status, type, q: debouncedSearch, page, pageSize: DEFAULT_PAGE_SIZE }),
    [role, status, type, debouncedSearch, page],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
      setLoading(true);
      setError(null);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    async function load() {
      try {
        const result = await listPeople(query, controller.signal);
        if (!active) return;
        setData(result);
        setSelectedId((current) =>
          result.people.some((person) => person.id === current) ? current : result.people[0]?.id ?? null,
        );
      } catch {
        if (!active) return;
        setError(
          controller.signal.aborted
            ? "The request took too long. Try again."
            : "Couldn’t load people. Try again.",
        );
      } finally {
        clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query, reloadKey]);

  const people = data?.people ?? [];
  const selected: Person | null = people.find((person) => person.id === selectedId) ?? null;
  const total = data?.total ?? 0;
  const currentPage = data?.page ?? page;
  const pages = pageCount(total, data?.pageSize ?? DEFAULT_PAGE_SIZE);

  function handleSearch(next: string) {
    setSearch(next);
    setLoading(true);
    setError(null);
    setNotice(null);
  }

  function changeRole(next: string) {
    setRole(next === "VOLUNTEER" ? "VOLUNTEER" : "DONOR");
    setType("ALL");
    setPage(1);
    setSelectedId(null);
    setNotice(null);
    setLoading(true);
    setError(null);
  }

  function changeStatus(next: string) {
    setStatus(next === "ACTIVE" || next === "SUSPENDED" ? next : "ALL");
    setPage(1);
    setSelectedId(null);
    setNotice(null);
    setLoading(true);
    setError(null);
  }

  function changeType(next: string) {
    setType(next === "ESTABLISHMENT" || next === "INDIVIDUAL" ? next : "ALL");
    setPage(1);
    setSelectedId(null);
    setNotice(null);
    setLoading(true);
    setError(null);
  }

  function changePage(next: number) {
    setPage(Math.min(Math.max(next, 1), pages));
    setSelectedId(null);
    setNotice(null);
    setLoading(true);
    setError(null);
  }

  async function run(action: "suspend" | "reactivate", reason?: string) {
    if (!selected) return;
    if (action === "suspend") {
      const reasonError = validateSuspendReason(reason ?? "");
      if (reasonError) {
        setDialogError(reasonError);
        return;
      }
    }
    setPending(true);
    setDialogError(undefined);
    const result =
      action === "suspend"
        ? await suspendAccount(selected.id, reason ?? "")
        : await reactivateAccount(selected.id);
    setPending(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            people: current.people.map((person) =>
              person.id === selected.id ? { ...person, status: result.resultingStatus } : person,
            ),
          }
        : current,
    );
    setNotice(
      action === "suspend"
        ? `${selected.label} is now suspended. The change is recorded in the audit log.`
        : `${selected.label} is active again. The change is recorded in the audit log.`,
    );
    setDialog(null);
    setReloadKey((value) => value + 1);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Donors & volunteers"
        description="Manage account status and inspect activity without changing distribution records."
      />

      <TabBar
        label="Account type"
        value={role}
        onChange={changeRole}
        tabs={[
          { id: "DONOR", label: "Donors", count: data?.counts.DONOR },
          { id: "VOLUNTEER", label: "Volunteers", count: data?.counts.VOLUNTEER },
        ]}
      />

      {notice ? (
        <FeedbackBanner tone="success" title="Success">
          {notice}
        </FeedbackBanner>
      ) : null}
      {error ? (
        <FeedbackBanner
          tone="error"
          title="Couldn’t load people"
          action={{
            label: "Try again",
            onClick: () => {
              setLoading(true);
              setError(null);
              setReloadKey((value) => value + 1);
            },
          }}
        >
          {error}
        </FeedbackBanner>
      ) : null}

      <FilterBar>
        <SearchInput
          label="Search name, business, or email"
          placeholder="Search name, business, or email"
          value={search}
          onChange={handleSearch}
        />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <FilterSelect
            label="Status"
            value={status}
            onChange={changeStatus}
            options={[
              { value: "ALL", label: "All" },
              { value: "ACTIVE", label: "Active" },
              { value: "SUSPENDED", label: "Suspended" },
            ]}
          />
          {role === "DONOR" ? (
            <FilterSelect
              label="Type"
              value={type}
              onChange={changeType}
              options={[
                { value: "ALL", label: "All" },
                { value: "ESTABLISHMENT", label: "Establishment" },
                { value: "INDIVIDUAL", label: "Individual" },
              ]}
            />
          ) : null}
        </div>
      </FilterBar>

      {loading ? <DataTableSkeleton rows={5} columns={5} label="Loading people" /> : null}

      {!loading && people.length === 0 ? (
        <EmptyState title="No matching accounts" description="Try a different search or filter." />
      ) : null}

      {!loading && people.length > 0 ? (
        <>
          <div className="space-y-3 md:hidden">
            {people.map((person) => (
              <article key={person.id} className="rounded-xl border border-border bg-card p-4">
                <p className="font-medium text-foreground">{person.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {roleLabel(person.kind)} · {donorTypeLabel(person.donorType)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">Status: {statusLabel(person.status)}</p>
                <p className="mt-1 text-sm text-muted-foreground">{person.recentActivity}</p>
                <Button
                  type="button"
                  variant={person.id === selectedId ? "default" : "outline"}
                  className="mt-4 min-h-11 w-full"
                  onClick={() => setSelectedId(person.id)}
                  aria-pressed={person.id === selectedId}
                >
                  View <ArrowRight className="size-4" aria-hidden />
                </Button>
              </article>
            ))}
          </div>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person / establishment</TableHead>
                  <TableHead>Role / type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recent activity</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCellStrong>{person.label}</TableCellStrong>
                    <TableCell>
                      {roleLabel(person.kind)} · {donorTypeLabel(person.donorType)}
                    </TableCell>
                    <TableCell>{statusLabel(person.status)}</TableCell>
                    <TableCell>{person.recentActivity}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setSelectedId(person.id)}
                        aria-label={`View ${person.label}`}
                        aria-pressed={person.id === selectedId}
                        className="inline-flex min-h-11 items-center gap-1 rounded-lg font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        View <ArrowRight className="size-4" aria-hidden />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}

      {!loading ? (
        <nav aria-label="People pagination" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">{rangeSummary(total, currentPage, data?.pageSize ?? DEFAULT_PAGE_SIZE)}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={currentPage <= 1}
              onClick={() => changePage(currentPage - 1)}
            >
              Previous
            </Button>
            <span className="shrink-0 text-sm text-muted-foreground">
              Page {currentPage} of {pages}
            </span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              disabled={currentPage >= pages}
              onClick={() => changePage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}

      {selected ? (
        <SectionCard title={selected.title} tone="success" className="p-4 sm:p-6 md:p-8">
          <p className="break-words">{selected.email} · {selected.phone}</p>
          <p className="mt-1">Status: {statusLabel(selected.status)}</p>
          <p className="mt-1">{selected.stats.map((stat) => `${stat.value} ${stat.label.toLowerCase()}`).join(" · ")}</p>
          <p className="mt-1">
            Activity: {selected.activity.length > 0 ? selected.activity.join(" · ") : "No recent activity"}
          </p>
          <div className="mt-8">
            {selected.status === "ACTIVE" ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                onClick={() => {
                  setDialogError(undefined);
                  setDialog("suspend");
                }}
              >
                Suspend account
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                onClick={() => {
                  setDialogError(undefined);
                  setDialog("reactivate");
                }}
              >
                Reactivate account
              </Button>
            )}
          </div>
        </SectionCard>
      ) : null}

      <p className="text-sm leading-5 text-muted-foreground">
        Only active volunteers can receive assignments. Every suspension and reactivation is recorded in the audit log.
      </p>

      <ConfirmDialog
        open={dialog === "suspend"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Suspend account?"
        description="This blocks login and prevents new volunteer assignments."
        reasonLabel="Reason (required)"
        confirmLabel="Suspend account"
        cancelLabel="Keep active"
        tone="destructive"
        pending={pending}
        error={dialogError}
        onConfirm={(reason) => run("suspend", reason)}
      />
      <ConfirmDialog
        open={dialog === "reactivate"}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Reactivate account?"
        description="This restores login and allows new volunteer assignments."
        confirmLabel="Reactivate account"
        cancelLabel="Go back"
        tone="primary"
        pending={pending}
        error={dialogError}
        onConfirm={() => run("reactivate")}
      />
    </div>
  );
}
