"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Leaf, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumb } from "@/components/shared/breadcrumb";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { organizationNav, type NavItem } from "./nav-items";

const focus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {items.map(({ label, href, icon: Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm",
                focus,
                active ? "bg-success font-semibold text-primary" : "text-muted-foreground hover:bg-success/60",
              )}
            >
              <Icon className="size-6 shrink-0" aria-hidden />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Organization workspace shell (sidebar 240px / 32px gutters at desktop,
 * compact drawer nav below lg). Shared — build ONE, reuse for every org screen.
 * OWNERSHIP: the organization workspace is split across Veni, Braylle and Arwin —
 * confirm this shell with both of them before merging (FRONTEND_ASSIGNMENTS.md).
 * The notifications bell is disabled until the notifications inbox route lands.
 */
export function OrganizationShell({
  breadcrumbLabel,
  user = { name: "Organization admin", role: "Administrator" },
  unreadCount = 0,
  showSampleBadge = false,
  children,
}: {
  breadcrumbLabel: string;
  user?: { name: string; role: string };
  unreadCount?: number;
  showSampleBadge?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <p className="mb-6 flex items-center gap-2 px-3 text-xl font-semibold text-primary">
        <Leaf className="size-6" aria-hidden /> FoodLink
      </p>
      <p className="mb-3 px-3 text-xs font-medium leading-[18px] text-muted-foreground">ORGANIZATION WORKSPACE</p>
      <nav aria-label="Organization workspace" className="flex-1 overflow-y-auto">
        <NavList items={organizationNav} onNavigate={onNavigate} />
      </nav>
      <div className="space-y-2 px-0 pt-6">
        <div className="px-3 text-sm leading-5 text-muted-foreground">
          <p>{user.name}</p>
          <p>{user.role}</p>
        </div>
        <SignOutButton callbackUrl="/admin/login" className="w-full" />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh bg-card p-4 lg:block">{sidebar()}</aside>

      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-3 bg-card px-5 lg:bg-transparent lg:px-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Open navigation"
              aria-expanded={open}
              aria-controls={drawerId}
              onClick={() => setOpen(true)}
              className={cn("grid size-11 place-items-center rounded-lg text-primary lg:hidden", focus)}
            >
              <Menu className="size-6" aria-hidden />
            </button>
            <Breadcrumb items={[{ label: "Workspace" }, { label: breadcrumbLabel }]} />
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {showSampleBadge ? <span>Sample data</span> : null}
            {/* Notifications inbox route does not exist yet (Arwin, next sprint). Disabled until it lands. */}
            <button
              type="button"
              disabled
              title="Notifications are not available yet"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}. Not available yet.`}
              className={cn("relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg text-muted-foreground opacity-60", focus)}
            >
              <Bell className="size-6" aria-hidden />
              {unreadCount ? <span className="text-sm font-semibold text-primary">{unreadCount}</span> : null}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] px-5 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          <div id={drawerId} role="dialog" aria-modal="true" aria-label="Navigation" className="relative h-full w-[280px] max-w-[85vw] bg-card p-4">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setOpen(false)}
              className={cn("absolute right-2 top-2 grid size-11 place-items-center rounded-lg", focus)}
            >
              <X className="size-6" aria-hidden />
            </button>
            {sidebar(() => setOpen(false))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
