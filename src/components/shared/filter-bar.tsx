"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Search + filters strip used on every list screen. */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card p-3 md:flex-row md:items-center md:justify-between md:px-5">
      {children}
    </div>
  );
}

export function SearchInput({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex-1">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border-transparent bg-transparent px-2 focus-visible:ring-2"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>{label}:</span>
      {/* The slot is as wide as the longest option (hidden copies share one grid cell), so the
          label never moves; the select is as wide as the chosen value, so the chevron follows it. */}
      <div className="grid">
        {options.map((o) => (
          <span
            key={o.value}
            aria-hidden="true"
            className="invisible col-start-1 row-start-1 whitespace-nowrap px-2 pr-12 text-base"
          >
            {o.label}
          </span>
        ))}
        <div className="col-start-1 row-start-1 w-fit justify-self-start">
          <Select
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 field-sizing-content border-transparent bg-transparent px-2 pr-12 focus-visible:ring-2"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </label>
  );
}
