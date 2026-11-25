"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTableSkeleton } from "@/components/shared/table-skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Table, TableBody, TableCell, TableCellStrong, TableHead, TableHeader, TableRow } from "@/components/shared/data-table";
import type { AdminDashboardResponse } from "@/contracts/admin-dashboard";
import { ACTIVITY_TYPE_LABEL, DASHBOARD_ERROR, countCards, formatActivityTime, loadDashboard } from "./command-center-logic";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; dashboard: AdminDashboardResponse };

export function CommandCenterView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [retry, setRetry] = useState(0);
  const runRef = useRef(0);

  useEffect(() => {
    runRef.current += 1;
    const mine = runRef.current;
    void loadDashboard().then((dashboard) => {
      if (runRef.current !== mine) return;
      setState(dashboard ? { status: "ready", dashboard } : { status: "error" });
    });
    return () => {
      runRef.current += 1;
    };
  }, [retry]);

  return (
    <main className="space-y-6">
      <PageHeader
        title="Command center"
        description="Priorities, counts, and recent activity across the admin workflow."
        actions={
          <Button variant="outline" onClick={() => { setState({ status: "loading" }); setRetry((v) => v + 1); }}>
            Refresh
          </Button>
        }
      />

      {state.status === "loading" ? <DataTableSkeleton rows={4} columns={4} label="Loading command center" /> : null}

      {state.status === "error" ? (
        <FeedbackBanner
          tone="error"
          title="Could not load command center"
          action={{ label: "Try again", onClick: () => { setState({ status: "loading" }); setRetry((v) => v + 1); } }}
        >
          {DASHBOARD_ERROR}
        </FeedbackBanner>
      ) : null}

      {state.status === "ready" ? (
        <>
          <section aria-label="Operational counts" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {countCards(state.dashboard.counts).map((card) => (
              <Link key={card.label} href={card.href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <StatCard label={card.label} value={card.value} variant={card.variant} className="h-full transition-colors hover:bg-muted/40" />
              </Link>
            ))}
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <SectionCard title="Recent activity" as="h2">
              {state.dashboard.recentActivity.length === 0 ? (
                <EmptyState title="No recent activity" description="New registrations, screenings, and donation updates will appear here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {state.dashboard.recentActivity.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{ACTIVITY_TYPE_LABEL[item.type]}</TableCell>
                        <TableCell>
                          <TableCellStrong>{item.title}</TableCellStrong>
                          <p className="mt-1 text-muted-foreground">{item.detail}</p>
                        </TableCell>
                        <TableCell><span className="tabular-nums">{formatActivityTime(item.occurredAt)}</span></TableCell>
                        <TableCell>
                          <Button asChild variant="outline" className="min-h-11">
                            <Link href={item.href}>Open</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </SectionCard>

            <SectionCard title="Priority actions" as="h2">
              <div className="space-y-3 text-body text-foreground">
                <p className="text-pretty text-muted-foreground">Review items that need admin attention.</p>
                <ul className="space-y-2">
                  <li><Link className="text-primary underline-offset-4 hover:underline" href="/admin/registrations">Review pending registrations</Link></li>
                  <li><Link className="text-primary underline-offset-4 hover:underline" href="/admin/screenings">Review screening decisions</Link></li>
                  <li><Link className="text-primary underline-offset-4 hover:underline" href="/admin/donation-queue">Review posted donations</Link></li>
                  <li><Link className="text-primary underline-offset-4 hover:underline" href="/admin/assignments">Assign accepted donations</Link></li>
                </ul>
              </div>
            </SectionCard>
          </div>
        </>
      ) : null}
    </main>
  );
}
