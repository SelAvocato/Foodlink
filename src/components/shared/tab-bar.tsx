"use client";

import { useId, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type TabItem = { id: string; label: string; count?: number };

/** Underline tabs with optional counts (Drafts 1 / Active 3 / Donors / Volunteers). */
export function TabBar({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const base = useId();
  function onKeyDown(e: KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].id);
    document.getElementById(`${base}-${tabs[next].id}`)?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-6">
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            id={`${base}-${t.id}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-11 border-b-2 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary" : "border-transparent hover:border-border",
            )}
          >
            {t.label}
            {typeof t.count === "number" ? <span className="ml-2">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
