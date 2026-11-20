"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Leaf, ShieldCheck, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

// Only pages that exist today; Messages, Achievements and Profile join when built.
const NAV_ITEMS: NavItem[] = [
  { href: "/donor/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/donor/donations", label: "My donations", icon: Users },
  { href: "/donor/donate", label: "Donate", icon: ShieldCheck },
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
      <aside className="flex w-full shrink-0 flex-col bg-white md:min-h-screen md:w-[242px]">
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
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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
        <header className="flex h-[78px] items-center bg-white px-8 text-sm text-[#63746d]">
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
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
