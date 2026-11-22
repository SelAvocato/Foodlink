"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Clock, LayoutDashboard, Leaf, Package, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };

// Items marked soon have no page yet: shown greyed and not clickable, to show the panel what is planned.
const NAV_ITEMS: NavItem[] = [
  { href: "/donor/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/donor/donations", label: "My donations", icon: Users },
  { href: "/donor/donate", label: "Donate", icon: ShieldCheck },
  { href: "/donor/messages", label: "Messages", icon: Package, soon: true },
  { href: "/donor/achievements", label: "Achievements", icon: Users, soon: true },
  { href: "/donor/profile", label: "Profile", icon: Clock, soon: true },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function breadcrumbFor(pathname: string): string[] {
  const crumbs = ["Workspace"];
  const item = NAV_ITEMS.find((i) => isActive(pathname, i.href));
  if (item) crumbs.push(item.label);
  if (pathname.startsWith("/donor/donations/")) crumbs.push("Tracking");
  return crumbs;
}

export function DonorShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const crumbs = breadcrumbFor(pathname);

  return (
    <div className="flex min-h-screen flex-col bg-white md:flex-row">
      <aside className="flex w-full shrink-0 flex-col bg-white md:sticky md:top-0 md:h-screen md:w-[242px] md:self-start">
        <div className="flex h-[78px] items-center gap-2 px-7">
          <Leaf aria-hidden className="size-5 text-[#176448]" />
          <span className="text-2xl font-bold text-[#176448]">FoodLink</span>
        </div>
        <p className="px-6 text-[11px] font-medium uppercase tracking-wide text-[#63746d]">
          Donor workspace
        </p>
        <nav
          aria-label="Donor workspace"
          className="mt-6 flex gap-[6px] overflow-x-auto px-[18px] md:flex-col"
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon, soon }) => {
              if (soon) {
                return (
                  <span
                    key={href}
                    aria-disabled="true"
                    className="flex min-h-11 shrink-0 cursor-not-allowed items-center gap-3 rounded-sm px-3 text-sm font-medium text-[#63746d]/50"
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
                    ? "bg-[#eaf4ee] text-[#176448]"
                    : "text-[#63746d] hover:bg-[#eaf4ee]/60 hover:text-[#176448]",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-[18px] py-4">
          <SignOutButton className="w-full" />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-[#f5f7f5]">
        <header className="sticky top-0 z-10 flex h-[78px] items-center bg-white px-8 text-sm text-[#63746d]">
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              {crumbs.map((crumb, i) => (
                <li key={crumb} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>/</span>}
                  <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>
                    {crumb}
                  </span>
                </li>
              ))}
            </ol>
          </nav>
        <div
            role="img"
            aria-label="Notifications (coming soon)"
            className="ml-auto text-[#63746d] md:mr-24"
          >
            <Bell aria-hidden className="size-6" />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
