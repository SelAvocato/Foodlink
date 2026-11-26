"use client";

import type { ChangeEvent, FormEvent } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { GROUP_SERVED_OPTIONS, UNUSABLE_REASON_OPTIONS } from "./options";

interface DistributionEntryViewProps {
  title: string;
  subtitle: string;
  form: {
    date: string;
    place: string;
    groupServed: string;
    peopleServed: string;
    portionsDistributed: string;
    portionsUnusable: string;
    unusableReason: string;
    notes: string;
  };
  errors: {
    date?: string;
    place?: string;
    peopleServed?: string;
    portionsDistributed?: string;
    portionsUnusable?: string;
    unusableReason?: string;
    notes?: string;
  };
  banner: string | null;
  isSubmitting: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onDateChange: (value: string) => void;
  onPlaceChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onGroupChange: (value: string) => void;
  onPeopleChange: (value: string) => void;
  onPortionsChange: (value: string) => void;
  onUnusableChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
}

/** Join the ids of the hints that apply, or undefined so no attribute is rendered. */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value === "" ? undefined : value;
}

export function DistributionEntryView({
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
}: DistributionEntryViewProps) {
  return (
    <div className="mx-auto w-full max-w-[390px] px-5 py-6">
      <h1 className="text-display font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      {banner !== null ? (
        <FeedbackBanner tone="error" title="Couldn't save changes">
          {banner}
        </FeedbackBanner>
      ) : null}
      <form onSubmit={onSave} className="mt-6 space-y-5">
        <div>
          <label
            htmlFor="entry-date"
            className="block text-sm font-semibold text-foreground"
          >
            Date
          </label>
          <input
            id="entry-date"
            type="date"
            value={form.date}
            onChange={(e) => onDateChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSubmitting}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? "entry-date-error" : undefined}
          />
          {errors.date ? (
            <p id="entry-date-error" className="text-sm text-[#B3261E] mt-1">
              {errors.date}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="entry-place"
            className="block text-sm font-semibold text-foreground"
          >
            Place · Site or barangay area
          </label>
          <input
            id="entry-place"
            type="text"
            value={form.place}
            onChange={onPlaceChange}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            inputMode="text"
            placeholder="Community center, Brgy. Central"
            disabled={isSubmitting}
            aria-invalid={errors.place ? true : undefined}
            aria-describedby={errors.place ? "entry-place-error" : undefined}
          />
          {errors.place ? (
            <p id="entry-place-error" className="text-sm text-[#B3261E] mt-1">
              {errors.place}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="entry-group"
            className="block text-sm font-semibold text-foreground"
          >
            Group served
          </label>
          <select
            id="entry-group"
            value={form.groupServed}
            onChange={(e) => onGroupChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSubmitting}
          >
            {GROUP_SERVED_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="entry-people"
            className="block text-sm font-semibold text-foreground"
          >
            People served · Whole number
          </label>
          <input
            id="entry-people"
            type="text"
            value={form.peopleServed}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              onPeopleChange(v);
            }}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            inputMode="numeric"
            placeholder="1"
            disabled={isSubmitting}
            aria-invalid={errors.peopleServed ? true : undefined}
            aria-describedby={errors.peopleServed ? "entry-people-error" : undefined}
          />
          {errors.peopleServed ? (
            <p id="entry-people-error" className="text-sm text-[#B3261E] mt-1">
              {errors.peopleServed}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="entry-portions"
            className="block text-sm font-semibold text-foreground"
          >
            Portions distributed
          </label>
          <input
            id="entry-portions"
            type="text"
            value={form.portionsDistributed}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              onPortionsChange(v);
            }}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            inputMode="numeric"
            placeholder="1"
            disabled={isSubmitting}
            aria-invalid={errors.portionsDistributed ? true : undefined}
            aria-describedby={
              errors.portionsDistributed ? "entry-portions-error" : undefined
            }
          />
          {errors.portionsDistributed ? (
            <p id="entry-portions-error" className="text-sm text-[#B3261E] mt-1">
              {errors.portionsDistributed}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="entry-unusable"
            className="block text-sm font-semibold text-foreground"
          >
            Unusable portions
          </label>
          <input
            id="entry-unusable"
            type="text"
            value={form.portionsUnusable}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              onUnusableChange(v);
            }}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            inputMode="numeric"
            disabled={isSubmitting}
            aria-invalid={errors.portionsUnusable ? true : undefined}
            aria-describedby={
              errors.portionsUnusable ? "entry-unusable-error" : undefined
            }
          />
          {errors.portionsUnusable ? (
            <p id="entry-unusable-error" className="text-sm text-[#B3261E] mt-1">
              {errors.portionsUnusable}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="entry-unusable-reason"
            className="block text-sm font-semibold text-foreground"
          >
            Unusable reason
          </label>
          <p className="mt-1 text-sm text-foreground">Required when greater than 0</p>
          <select
            id="entry-unusable-reason"
            value={form.unusableReason}
            disabled={Number(form.portionsUnusable) === 0}
            onChange={(e) => onReasonChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-invalid={errors.unusableReason ? true : undefined}
            aria-describedby={describedBy(
              errors.unusableReason ? "entry-unusable-reason-error" : undefined,
              Number(form.portionsUnusable) === 0
                ? "entry-unusable-reason-locked"
                : undefined,
            )}
          >
            <option value="">Select a reason</option>
            {UNUSABLE_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.unusableReason ? (
            <p
              id="entry-unusable-reason-error"
              className="text-sm text-[#B3261E] mt-1"
            >
              {errors.unusableReason}
            </p>
          ) : null}
          {Number(form.portionsUnusable) === 0 && (
            <p
              id="entry-unusable-reason-locked"
              className="text-sm text-[#6B7280] mt-1"
            >
              Locked until unusable portions &gt; 0
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="entry-notes"
            className="block text-sm font-semibold text-foreground"
          >
            Notes (optional)
          </label>
          <textarea
            id="entry-notes"
            value={form.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Packaging damaged during handover."
            disabled={isSubmitting}
            maxLength={1000}
            aria-invalid={errors.notes ? true : undefined}
            aria-describedby={errors.notes ? "entry-notes-error" : undefined}
          />
          {errors.notes ? (
            <p id="entry-notes-error" className="text-sm text-[#B3261E] mt-1">
              {errors.notes}
            </p>
          ) : null}
        </div>

        {/* TODO: distribution photos have no upload endpoint yet. Add the picker
            back when a photo route exists. */}
        <p className="rounded-xl bg-[#EAF4EE]/60 p-4 text-sm text-[#63746D] mt-4">
          Do not include beneficiary names, home addresses, or identifiable faces.
        </p>

        <div className="mt-6 space-y-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[48px] rounded-xl bg-[#1B6B46] text-white text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Saving…" : "Save entry"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="w-full min-h-[48px] rounded-xl border border-neutral-200 bg-white text-[#1B6B46] text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
