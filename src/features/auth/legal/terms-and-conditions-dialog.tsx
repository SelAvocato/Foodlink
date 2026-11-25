"use client";

import { TERMS_AND_CONDITIONS_CONTENT } from "./legal-content";
import { LegalDocumentDialog } from "./legal-document-dialog";

type TermsAndConditionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function TermsAndConditionsDialog({ open, onOpenChange }: TermsAndConditionsDialogProps) {
  return <LegalDocumentDialog open={open} onOpenChange={onOpenChange} document={TERMS_AND_CONDITIONS_CONTENT} />;
}
