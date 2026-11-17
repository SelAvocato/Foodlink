"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "./form-field";
import { Textarea } from "@/components/ui/textarea";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** The ONE primary action, e.g. "Suspend account". */
  confirmLabel: string;
  /** Secondary, e.g. "Keep active" / "Go back". */
  cancelLabel: string;
  /** destructive = red primary; primary = green primary (Reassign, Complete). */
  tone?: "destructive" | "primary";
  /** When set, a required reason textarea is shown and gates the primary action. */
  reasonLabel?: string;
  /** Shown under the description. Pass null to hide. */
  recordedNote?: string | null;
  /** Inline failure (generic error with retry). */
  error?: string;
  pending?: boolean;
  onConfirm: (reason?: string) => void | Promise<void>;
};

const DEFAULT_NOTE = "This action is recorded in the donation or account history.";

/** p40 — reusable confirm dialog: one clear primary action, optional required reason. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "destructive",
  reasonLabel,
  recordedNote = DEFAULT_NOTE,
  error,
  pending,
  onConfirm,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const needsReason = Boolean(reasonLabel);
  const reasonMissing = needsReason && reason.trim().length === 0;

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason("");
      setTouched(false);
    }
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (reasonMissing) {
      setTouched(true);
      return;
    }
    await onConfirm(needsReason ? reason.trim() : undefined);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold leading-7">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-5">{description}</DialogDescription>
        </DialogHeader>

        {needsReason ? (
          <FormField label={reasonLabel!} error={touched && reasonMissing ? "Enter a reason to continue." : undefined}>
            {(p) => (
              <Textarea {...p} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            )}
          </FormField>
        ) : null}

        {recordedNote ? <p className="text-xs leading-[18px] text-muted-foreground">{recordedNote}</p> : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="gap-3 sm:justify-start">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === "destructive" ? "destructive" : "default"}
            className="min-h-11"
            disabled={pending}
            onClick={handleConfirm}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
