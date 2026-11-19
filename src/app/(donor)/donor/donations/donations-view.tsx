import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableCellStrong,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar, FilterSelect, SearchInput } from "@/components/shared/filter-bar";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { TabBar, type TabItem } from "@/components/shared/tab-bar";

/** One table row, already formatted for display. */
export type DonationRowView = {
  id: string;
  /** "#9FC03951" */
  code: string;
  name: string;
  category: string;
  portions: number;
  /** Status label, e.g. "Assigned". */
  status: string;
  /** The pickup window as text, or a dash. */
  pickup: string;
  /** A link shown beside the pickup text; null until the target page exists. */
  action: { label: string; href: string } | null;
};

/** A summary card under the table (Figma p12). */
export type HighlightCardView = {
  label: string;
  tone: "default" | "error";
  title: string;
  text: string;
  actions: { label: string; href?: string; arrow?: boolean }[];
};

export type DonationsViewProps = {
  tabs: TabItem[];
  tab: string;
  onTabChange: (id: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusOptions: { value: string; label: string }[];
  status: string;
  onStatusChange: (value: string) => void;
  rows: DonationRowView[];
  empty: { title: string; description: string };
  summary: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Replaces the table and pager (loading skeleton or error banner). */
  body?: ReactNode;
  /** Summary cards under the table (Figma p12). */
  highlights?: HighlightCardView[];
};

export function DonationsView(props: DonationsViewProps) {
  const { rows } = props;
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
        <PageHeader
          title="My donations"
          description="Follow every donation, from draft to documented distribution."
          actions={
            <Button asChild className="min-w-[210px] rounded-sm">
              <Link href="/donor/donate">
                <Plus aria-hidden className="size-4" />
                Donate food
              </Link>
            </Button>
          }
        />
        <TabBar
          tabs={props.tabs}
          value={props.tab}
          onChange={props.onTabChange}
          label="Donation tabs"
        />
        <FilterBar>
          <SearchInput
            label="Search donations"
            placeholder="Search food name or donation ID"
            value={props.search}
            onChange={props.onSearchChange}
          />
          <FilterSelect
            label="Status"
            value={props.status}
            onChange={props.onStatusChange}
            options={props.statusOptions}
          />
        </FilterBar>
        {props.body !== undefined ? (
          props.body
        ) : rows.length === 0 ? (
          <EmptyState title={props.empty.title} description={props.empty.description} />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Donation</TableHead>
                  <TableHead>Food category</TableHead>
                  <TableHead>Portions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pickup / action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCellStrong>
                      {row.code} · {row.name}
                    </TableCellStrong>
                    <TableCell>{row.category}</TableCell>
                    <TableCell>{row.portions}</TableCell>
                    <TableCell>{row.status}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span>{row.pickup}</span>
                        {row.action ? (
                          <Link
                            href={row.action.href}
                            className="inline-flex min-h-11 items-center gap-1 rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {row.action.label}
                            <ArrowRight aria-hidden className="size-4" />
                          </Link>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              summary={props.summary}
              page={props.page}
              pageCount={props.pageCount}
              onPageChange={props.onPageChange}
            />
          </>
        )}
        {props.highlights && props.highlights.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2">
            {props.highlights.map((card) => (
              <section
                key={card.label}
                aria-label={card.label}
                className="flex flex-col gap-3 rounded-xl bg-card p-6"
              >
                <p
                  className={
                    card.tone === "error"
                      ? "text-xs font-semibold uppercase tracking-wide text-[#B23D37]"
                      : "text-xs font-semibold uppercase tracking-wide text-primary"
                  }
                >
                  {card.label}
                </p>
                <h2 className="text-xl font-semibold text-foreground">{card.title}</h2>
                <p className="text-sm text-muted-foreground">{card.text}</p>
                <div className="mt-2 flex flex-wrap gap-x-10">
                  {card.actions.map((action) => {
                    const cls =
                      "inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
                    const content = (
                      <>
                        {action.label}
                        {action.arrow ? <ArrowRight aria-hidden className="size-4" /> : null}
                      </>
                    );
                    return action.href ? (
                      <Link key={action.label} href={action.href} className={cls}>
                        {content}
                      </Link>
                    ) : (
                      <button key={action.label} type="button" className={cls}>
                        {content}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
