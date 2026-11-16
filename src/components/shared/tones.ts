/**
 * Single source for tone -> theme-class mapping.
 * Assumes globals.css exposes bg-success / bg-warning / bg-error and matching
 * text-*-foreground tokens. If your token names differ, change them HERE only.
 */
export type Tone = "success" | "warning" | "error" | "neutral";

export const toneSurface: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  neutral: "bg-card border border-border",
};

export const toneText: Record<Tone, string> = {
  success: "text-primary",
  warning: "text-warning-foreground",
  error: "text-error-foreground",
  neutral: "text-foreground",
};

/** Written label so status is never conveyed by colour alone. */
export const toneLabel: Record<Tone, string> = {
  success: "Success",
  warning: "Warning",
  error: "Error",
  neutral: "Notice",
};
