"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  Bell,
  ClipboardCheck,
  Clock,
  LayoutGrid,
  Leaf,
  Menu,
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
        if (soon) {
          return (
            <span
              key={href}
              aria-disabled="true"
              className="flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm font-medium text-muted-foreground/50"
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="flex-1">{label}</span>
              <span className="text-xs">Soon</span>
            </span>
          );
        }

        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-sm px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
    </>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const crumbs = breadcrumbFor(pathname);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-card md:flex-row">
      <aside className="hidden w-full shrink-0 flex-col bg-card md:sticky md:top-0 md:flex md:h-dvh md:w-[242px] md:self-start md:border-r md:border-border">
        <div className="flex h-[78px] items-center gap-2 px-7">
          <Leaf aria-hidden className="size-5 text-primary" />
          <span className="text-2xl font-bold text-primary">FoodLink</span>
        </div>
        <p className="px-6 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Admin workspace
        </p>
        <nav
          aria-label="Admin workspace"
          className="mt-6 flex flex-1 flex-col gap-[6px] overflow-y-auto px-[18px]"
        >
          <NavLinks pathname={pathname} />
        </nav>
        <div className="mt-auto px-[18px] py-4">
          <SignOutButton className="w-full" />
        </div>
      </aside>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="inset-y-0 left-0 top-0 h-dvh w-[min(20rem,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-r border-border p-0 sm:max-w-none"
        >
          <DialogTitle className="sr-only">Admin navigation</DialogTitle>
          <DialogDescription className="sr-only">Navigate the admin workspace.</DialogDescription>
          <div className="flex h-[78px] items-center gap-2 px-6 pr-14">
            <Leaf aria-hidden className="size-5 text-primary" />
            <span className="text-2xl font-bold text-primary">FoodLink</span>
          </div>
          <p className="px-6 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Admin workspace
          </p>
          <nav aria-label="Admin workspace" className="mt-6 flex flex-col gap-[6px] px-4">
            <NavLinks pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          </nav>
          <div className="mt-auto px-4 py-4">
            <SignOutButton className="w-full" />
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="sticky top-0 z-10 flex min-h-[64px] items-center gap-3 bg-card px-4 py-3 text-sm text-muted-foreground sm:px-6 md:h-[78px] md:px-8 md:py-0">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0 md:hidden"
            aria-label="Open navigation menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu aria-hidden className="size-5" />
          </Button>
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {crumbs.map((crumb, i) => (
                <li key={`${crumb}-${i}`} className="flex min-w-0 items-center gap-2">
                  {i > 0 ? <span aria-hidden>/</span> : null}
                  <span
                    className={i === crumbs.length - 1 ? "truncate font-medium text-foreground" : "truncate"}
                    aria-current={i === crumbs.length - 1 ? "page" : undefined}
                  >
                    {crumb}
                  </span>
                </li>
              ))}
            </ol>
          </nav>
          <div
            role="img"
            aria-label="Notifications (coming soon)"
            className="shrink-0 text-muted-foreground"
          >
            <Bell aria-hidden className="size-6" />
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
