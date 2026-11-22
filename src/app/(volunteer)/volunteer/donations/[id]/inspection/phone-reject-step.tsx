"use client";

import { Button } from "@/components/ui/button";
import { MAX_REJECT_NOTE, REJECT_REASONS } from "./pickup-inspection-logic";

const FULL_BUTTON = "h-[52px] w-full rounded-sm text-base font-semibold";
const FIELD =
  "block w-full rounded-sm border border-border bg-card px-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/**
 * Figma p49: the phone rejection screen. The category and the note are combined
 * into the one reason string the server stores.
 */
export function PhoneRejectStep({
  category,
  note,
  canConfirm,
  locked,
  onBack,
  onCategory,
  onNote,
  onConfirm,
}: {
  category: string;
  note: string;
  canConfirm: boolean;
  locked: boolean;
  onBack: () => void;
  onCategory: (category: string) => void;
  onNote: (note: string) => void;
  onConfirm: () => void;
}) {
  return (
    // The view pads itself px-6 py-8; cancel that so the page padding comes only
    // from the layout, as on p44, p45 and p47.
    <div className="-mx-6 -my-8">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-display font-semibold text-foreground">Reject this pickup</h1>
        <p className="mt-2 text-body text-muted-foreground">The food stays with the donor.</p>

        {/* KNOWN LIMIT: the donor and staff are not notified on rejection yet because the
            notification engine is not built; this text states what the System Structure requires. */}
        <p className="mt-7 rounded-md bg-[#FFF4DE] px-4 py-5 text-body text-[#885B16]">
          If you&apos;re unsure about safety, reject the pickup. The donor and staff will be notified.
        </p>

        <label htmlFor="phone-reject-reason" className="mt-9 block text-body font-medium text-foreground">
          Reason (required)
        </label>
        <select
          id="phone-reject-reason"
          value={category}
          onChange={(event) => onCategory(event.target.value)}
          disabled={locked}
          className={FIELD + " mt-2 h-12"}
        >
          <option value="">Choose a reason</option>
          {REJECT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reason}
            </option>
          ))}
        </select>

        <label htmlFor="phone-reject-note" className="mt-6 block text-body font-medium text-foreground">
          Describe what you observed
        </label>
        <textarea
          id="phone-reject-note"
          rows={5}
          maxLength={MAX_REJECT_NOTE}
          value={note}
          onChange={(event) => onNote(event.target.value)}
          disabled={locked}
          placeholder="Packaging is damaged and food has an unusual smell."
          className={FIELD + " mt-2 min-h-[138px] py-2"}
        />

        <div className="mt-8 rounded-md bg-[#FCEDEB] px-4 py-5 text-body text-[#B23D37]">
          <p>This records Rejected at pickup.</p>
          <p>This action cannot be reversed.</p>
        </div>

        <Button
          className={
            FULL_BUTTON +
            " mt-10 bg-[#B23D37] text-white enabled:hover:bg-[#9A322D] disabled:opacity-50"
          }
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          Confirm rejection
        </Button>
        <Button
          variant="outline"
          className={FULL_BUTTON + " mt-4"}
          disabled={locked}
          onClick={onBack}
        >
          Back to inspection
        </Button>
      </div>
    </div>
  );
}
