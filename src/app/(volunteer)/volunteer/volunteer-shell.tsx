"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Clock, Leaf, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };

// Items marked soon have no page yet: shown greyed and not clickable, to show the panel what is planned.
const NAV_ITEMS: NavItem[] = [
  { href: "/volunteer", label: "Tasks", icon: Package },
  { href: "/volunteer/history", label: "History", icon: Clock, soon: true },
  { href: "/volunteer/notifications", label: "Notifications", icon: Bell, soon: true },
];

// Tasks is active on every /volunteer page (list, task detail, scan, inspection).
// KNOWN LIMIT: when History or Notifications get real pages, this check must exclude their paths.
function isTasksActive(pathname: string) {
  return pathname === "/volunteer" || pathname.startsWith("/volunteer/");
}

export function VolunteerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      {/* Desktop: the plain header stays as it was. */}
      <header className="hidden min-h-14 items-center justify-between gap-4 border-b px-6 font-semibold md:flex">
        <span>FoodLink — Volunteer</span>
        <SignOutButton className="min-h-11" callbackUrl="/login" />
      </header>

      {/* Phone: app bar with logo, Log out and a static bell. */}
      <header className="flex h-16 items-center justify-between bg-card px-5 md:hidden">
        <span className="flex items-center gap-2 text-xl font-bold text-primary">
          <Leaf aria-hidden className="size-6" />
          FoodLink
        </span>
        <div className="flex items-center gap-1">
          <SignOutButton className="gap-2 px-2" callbackUrl="/login" />
          <span aria-hidden className="flex size-11 items-center justify-center text-muted-foreground">
            <Bell className="size-6" />
          </span>
        </div>
      </header>

      <div className="px-6 pb-24 pt-6 md:p-6">{children}</div>

      {/* Phone: bottom nav. Only Tasks is live. */}
      <nav
        aria-label="Volunteer"
        className="fixed inset-x-0 bottom-0 z-10 flex h-[72px] border-t bg-card md:hidden"
      >
        {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
          if (soon) {
            return (
              <span
                key={href}
                aria-disabled="true"
                className="flex min-h-11 flex-1 cursor-not-allowed flex-col items-center justify-center gap-1 text-caption font-medium text-muted-foreground/50"
              >
                <Icon aria-hidden className="size-6" />
                {label}
                <span className="sr-only"> (coming soon)</span>
              </span>
            );
          }
          const active = isTasksActive(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 flex-1 flex-col items-center justify-center gap-1 text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="size-6" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
