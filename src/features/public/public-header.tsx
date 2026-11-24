"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const focus = "rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function LeafIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ) : (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function PublicHeader({
  links,
  loginHref = "/login",
  signUpHref = "/#join",
}: {
  links: { label: string; href: string }[];
  loginHref?: string;
  signUpHref?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div className="mx-auto flex min-h-[68px] max-w-[1200px] items-center justify-between gap-6 px-5 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-8">
        <Link href="/" aria-label="FoodLink home" className={cn("inline-flex min-h-11 items-center gap-2 text-xl font-semibold leading-7 text-primary", focus)}>
          <LeafIcon />
          <span>FoodLink</span>
        </Link>

        <button
          type="button"
          className="grid size-11 place-items-center rounded-lg text-primary md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <MenuIcon open={open} />
        </button>

        <div
          id="site-menu"
          className={cn(
            "absolute left-0 right-0 top-full border-b border-border bg-card px-5 pb-5 pt-3 md:static md:contents md:border-0 md:p-0",
            open ? "flex flex-col gap-3" : "hidden md:contents",
          )}
        >
          <nav aria-label="Primary">
            <ul className="flex flex-col md:flex-row md:gap-2">
              {links.map((l) => {
                const active = pathname === l.href;
                return (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative inline-flex min-h-11 w-full items-center px-3 text-sm font-medium transition-colors md:w-auto",
                        active ? "text-primary font-semibold" : "text-muted-foreground hover:text-primary",
                        "after:absolute after:bottom-1.5 after:left-3 after:h-0.5 after:bg-primary after:transition-transform after:origin-left",
                        active ? "after:right-3 after:scale-x-100" : "after:w-6 after:scale-x-0 hover:after:scale-x-100 md:after:right-3 md:after:w-auto",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded",
                      )}
                      onClick={() => setOpen(false)}
                    >
                      {l.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex flex-col gap-2 md:flex-row md:justify-self-end">
            <Link href={loginHref} className="inline-flex min-h-11 items-center justify-center rounded-lg px-5 text-sm font-semibold text-foreground hover:bg-success hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Log in</Link>
            <Link href={signUpHref} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Sign up</Link>
          </div>
        </div>
      </div>
    </header>
  );
}
