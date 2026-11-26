"use client";

import type { ChangeEvent, FormEvent } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import type { GroupServed, UnusableReason } from "@/contracts/volunteer-distribution";
import { GROUP_SERVED_OPTIONS, UNUSABLE_REASON_OPTIONS } from "./options";

const PRIMARY =
  "bg-[#176448] text-white enabled:hover:bg-[#12513a] disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE =
  "border border-[#DCE4DE] bg-white text-[#176448] enabled:hover:bg-[#EAF4EE] disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_BASE =
  "inline-flex min-h-11 h-[52px] w-full items-center justify-center rounded-sm text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ERROR_TEXT = "text-sm text-[#B3261E] mt-1";

type DistributionEntryForm = {
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: string;
  portionsDistributed: string;
  portionsUnusable: string;
  unusableReason: UnusableReason | "";
  notes: string;
};

type FieldErrors = Partial<Record<keyof DistributionEntryForm, string>>;

type DistributionEntryViewProps = {
  title: string;
  subtitle: string;
  form: DistributionEntryForm;
  errors: FieldErrors;
  banner: string | null;
  isSubmitting: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onDateChange: (value: string) => void;
  onPlaceChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onGroupChange: (value: GroupServed) => void;
  onPeopleChange: (value: string) => void;
  onPortionsChange: (value: string) => void;
  onUnusableChange: (value: string) => void;
  onReasonChange: (value: UnusableReason | "") => void;
  onNotesChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

export function DistributionEntryView(props: DistributionEntryViewProps) {
  const {
    title,
    subtitle,
    form,
    errors,
    banner,
    isSubmitting,
    onSave,
    onCancel,
    onDateChange,
    onPlaceChange,
    onGroupChange,
    onPeopleChange,
    onPortionsChange,
    onUnusableChange,
    onReasonChange,
    onNotesChange,
  } = props;

  const unusableNumber = Number(form.portionsUnusable);
  const reasonDisabled = !Number.isFinite(unusableNumber) || unusableNumber <= 0;

  return (
    <div className="mx-auto w-full max-w-[390px] px-5 py-6">
      <h1 className="text-display font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

      {banner !== null ? (
        <FeedbackBanner tone="error" title="Couldn't save changes. Your entries are preserved. Try again.">
          {banner}
        </FeedbackBanner>
      ) : null}

      <form onSubmit={onSave} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-foreground">
            Date
          </label>
          <input
            type="date"
            value={form.date}
            onChange={(event) => onDateChange(event.target.value)}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.date ? <p className={ERROR_TEXT}>{errors.date}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Place · Site or barangay area
          </label>
          <input
            type="text"
            value={form.place}
            onChange={onPlaceChange}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.place ? <p className={ERROR_TEXT}>{errors.place}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Group served
          </label>
          <select
            value={form.groupServed}
            onChange={(event) => onGroupChange(event.target.value as GroupServed)}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {GROUP_SERVED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            People served · Whole number
          </label>
          <input
            type="text"
            value={form.peopleServed}
            onChange={(event) => onPeopleChange(event.target.value)}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.peopleServed ? <p className={ERROR_TEXT}>{errors.peopleServed}</p> : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Portions distributed
          </label>
          <input
            type="text"
            value={form.portionsDistributed}
            onChange={(event) => onPortionsChange(event.target.value)}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.portionsDistributed ? (
            <p className={ERROR_TEXT}>{errors.portionsDistributed}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Unusable portions
          </label>
          <input
            type="text"
            value={form.portionsUnusable}
            onChange={(event) => onUnusableChange(event.target.value)}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.portionsUnusable ? (
            <p className={ERROR_TEXT}>{errors.portionsUnusable}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Unusable reason
          </label>
          <p className="mt-1 text-sm text-foreground">
            Required when &gt; 0
          </p>
          <select
            value={form.unusableReason}
            disabled={reasonDisabled}
            onChange={(event) => onReasonChange(event.target.value as UnusableReason | "")}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select a reason</option>
            {UNUSABLE_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.unusableReason ? (
            <p className={ERROR_TEXT}>{errors.unusableReason}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Notes (optional)
          </label>
          <textarea
            value={form.notes}
            onChange={onNotesChange}
            className="block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {errors.notes ? <p className={ERROR_TEXT}>{errors.notes}</p> : null}
        </div>

        {/* TODO: Add photo (optional) — no photo endpoint exists yet. */}
        <p className="mt-4 text-sm text-[#63746D]">
          Do not include beneficiary names, home addresses, or identifiable faces.
        </p>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`${BUTTON_BASE} mt-6 w-full ${PRIMARY}`}
        >
          Save entry
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className={`${BUTTON_BASE} mt-3 w-full ${OUTLINE}`}
        >
          Cancel
        </button>
      </form>
    </div>
  );
}
