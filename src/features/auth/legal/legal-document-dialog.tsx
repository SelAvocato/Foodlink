"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LegalDocument } from "./legal-content";

type LegalDocumentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: LegalDocument;
};

export function LegalDocumentDialog({ open, onOpenChange, document }: LegalDocumentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-balance">{document.title}</DialogTitle>
          <DialogDescription className="text-pretty">
            Version {document.version} · Last updated {document.lastUpdated}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pr-1 text-sm text-foreground">
          <p className="text-pretty text-muted-foreground">{document.intro}</p>
          {document.sections.map((section) => (
            <section key={section.heading} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph} className="text-pretty leading-6 text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
