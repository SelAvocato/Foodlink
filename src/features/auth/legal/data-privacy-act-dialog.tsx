"use client";

import { DATA_PRIVACY_ACT_CONTENT } from "./legal-content";
import { LegalDocumentDialog } from "./legal-document-dialog";

type DataPrivacyActDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DataPrivacyActDialog({ open, onOpenChange }: DataPrivacyActDialogProps) {
  return <LegalDocumentDialog open={open} onOpenChange={onOpenChange} document={DATA_PRIVACY_ACT_CONTENT} />;
}
