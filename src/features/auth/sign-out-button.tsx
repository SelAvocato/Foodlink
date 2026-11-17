"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ends the session and returns to the login page. Full-width ghost button;
 * pass className to fit tighter rows. Staff workspaces may pass
 * callbackUrl="/admin/login".
 */
export function SignOutButton({
  className,
  callbackUrl = "/login",
  children = "Log out",
}: {
  className?: string;
  callbackUrl?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl })}
      className={cn(
        "inline-flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-success/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <LogOut className="size-6 shrink-0" aria-hidden />
      {children}
    </button>
  );
}
