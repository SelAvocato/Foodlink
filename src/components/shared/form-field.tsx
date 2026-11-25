"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

/**
 * Label + control + hint + error. Error text stays beside the field (design rule).
 * Usage: <FormField label="Email" error={e}>{(p) => <Input {...p} name="email" />}</FormField>
 */
export function FormField({
  label,
  labelAction,
  hint,
  error,
  action,
  className,
  children,
}: {
  label: string;
  /** Rendered on the same row as the label, e.g. a "Forgot password?" link. */
  labelAction?: ReactNode;
  hint?: string;
  error?: string;
  /** Rendered below the control, aligned to the right. */
  action?: ReactNode;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-2", className)}>
      <div className={labelAction ? "flex items-center justify-between gap-2" : undefined}>
        <label htmlFor={id} className="block text-xs font-medium leading-[18px] text-foreground">
          {label}
        </label>
        {labelAction ? <div className="text-xs font-medium leading-[18px]">{labelAction}</div> : null}
      </div>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {action ? <div className="flex justify-end">{action}</div> : null}
      {hint ? (
        <p id={hintId} className="text-xs leading-[18px] text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-xs font-medium leading-[18px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
