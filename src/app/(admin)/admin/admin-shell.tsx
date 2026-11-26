"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  Clock,
  LayoutGrid,
  Leaf,
  Package,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserRound,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Command center", icon: LayoutGrid },
  { href: "/admin/registrations", label: "Registrations", icon: ClipboardCheck },
  { href: "/admin/screenings", label: "Screening reviews", icon: ShieldCheck },
  { href: "/admin/donation-queue", label: "Donation queue", icon: Package },
  { href: "/admin/assignments", label: "Assignments", icon: UserCheck },
  { href: "/admin/monitor", label: "Donation monitor", icon: Clock, soon: true },
  { href: "/admin/people", label: "Donors & volunteers", icon: Users },
  { href: "/admin/admins", label: "Admin accounts", icon: UserRound, soon: true },
  { href: "/admin/incidents", label: "Incidents", icon: ShieldAlert, soon: true },
  { href: "/admin/analytics", label: "Analytics & reports", icon: BarChart3, soon: true },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, soon: true },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(href + "/");
}

function breadcrumbFor(pathname: string): string[] {
  const crumbs = ["Workspace"];
  const item = NAV_ITEMS.find((navItem) => isActive(pathname, navItem.href));
  if (item) crumbs.push(item.label);
  return crumbs;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const crumbs = breadcrumbFor(pathname);

  return (
    <div className="flex min-h-dvh flex-col bg-card md:flex-row">
      <aside className="flex w-full shrink-0 flex-col bg-card md:sticky md:top-0 md:h-dvh md:w-[242px] md:self-start md:border-r md:border-border">
        <div className="flex h-[78px] items-center gap-2 px-7">
          <Leaf aria-hidden className="size-5 text-primary" />
          <span className="text-2xl font-bold text-primary">FoodLink</span>
        </div>
        <p className="px-6 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Admin workspace
        </p>
        <nav
          aria-label="Admin workspace"
          className="mt-6 flex gap-[6px] overflow-x-auto px-[18px] pb-2 md:flex-1 md:flex-col md:overflow-y-auto md:pb-0"
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
            if (soon) {
              return (
                <span
                  key={href}
                  aria-disabled="true"
                  className="flex min-h-11 shrink-0 cursor-not-allowed items-center gap-3 rounded-sm px-3 text-sm font-medium text-muted-foreground/50"
                >
                  <Icon aria-hidden className="size-5 shrink-0" />
                  {label}
                  <span className="sr-only"> (coming soon)</span>
                </span>
              );
            }

            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-success text-primary"
                    : "text-muted-foreground hover:bg-success/60 hover:text-primary",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="px-[18px] py-4 md:mt-auto">
          <SignOutButton className="w-full" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="sticky top-0 z-10 flex h-[78px] items-center bg-card px-6 text-sm text-muted-foreground md:px-8">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2">
              {crumbs.map((crumb, i) => (
                <li key={`${crumb}-${i}`} className="flex items-center gap-2">
                  {i > 0 ? <span aria-hidden>/</span> : null}
                  <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{crumb}</span>
                </li>
              ))}
            </ol>
          </nav>
          <div
            role="img"
            aria-label="Notifications (coming soon)"
            className="ml-auto text-muted-foreground md:mr-24"
          >
            <Bell aria-hidden className="size-6" />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
