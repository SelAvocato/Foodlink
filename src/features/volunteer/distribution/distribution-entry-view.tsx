"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useRef, useCallback } from "react";
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
  onPhotoChange: (file: File | null) => void;
  selectedPhoto: { file: File; preview: string } | null;
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
  onPhotoChange,
  selectedPhoto,
}: DistributionEntryViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputClick = () => {
    fileInputRef.current?.click();
  };

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        onPhotoChange(null);
        return;
      }

      // Validate file type
      if (!file.type.startsWith("image/")) {
        onPhotoChange(null);
        return;
      }

      // Validate file size (<= 5 MB)
      if (file.size > 5 * 1024 * 1024) {
        onPhotoChange(null);
        return;
      }

      onPhotoChange(file);
    },
    [onPhotoChange],
  );

  return (
    <div className="mx-auto w-full max-w-[390px] px-5 py-6">
      <h1 className="text-display font-semibold text-foreground">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {subtitle}
      </p>
      {banner !== null ? (
        <FeedbackBanner tone="error" title="Couldn't save changes">
          {banner}
        </FeedbackBanner>
      ) : null}
      <form onSubmit={onSave} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-semibold text-foreground">Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => onDateChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={isSubmitting}
          />
          {errors.date ? (
            <p className="text-sm text-[#B3261E] mt-1">{errors.date}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Place · Site or barangay area
          </label>
          <input
            type="text"
            value={form.place}
            onChange={onPlaceChange}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring input-input"
            inputMode="text"
            placeholder="Community center, Brgy. Central"
            disabled={isSubmitting}
          />
          {errors.place ? (
            <p className="text-sm text-[#B3261E] mt-1">{errors.place}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Group served
          </label>
          <select
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
          <label className="block text-sm font-semibold text-foreground">
            People served · Whole number
          </label>
          <input
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
          />
          {errors.peopleServed ? (
            <p className="text-sm text-[#B3261E] mt-1">{errors.peopleServed}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Portions distributed
          </label>
          <input
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
          />
          {errors.portionsDistributed ? (
            <p className="text-sm text-[#B3261E] mt-1">{errors.portionsDistributed}</p>
          ) : null}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Unusable portions
          </label>
          <input
            type="text"
            value={form.portionsUnusable}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, "");
              onUnusableChange(v);
            }}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            inputMode="numeric"
            
            disabled={isSubmitting}
          />
          {Number(form.portionsUnusable) === 0 && (
            <p className="text-sm text-[#6B7280] mt-1">
              Locked until unusable portions {String.fromCharCode(62)} 0
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Unusable reason
          </label>
          <p className="mt-1 text-sm text-foreground">
            Required when greater than 0
          </p>
          <select
            value={form.unusableReason}
            disabled={Number(form.portionsUnusable) === 0}
            onChange={(e) => onReasonChange(e.target.value)}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select a reason</option>
            {UNUSABLE_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {Number(form.portionsUnusable) === 0 && (
            <p className="text-sm text-[#6B7280] mt-1">
              Locked until unusable portions {String.fromCharCode(62)} 0
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold text-foreground">
            Notes (optional)
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => {
              if (e.target.value.length <= 300) {
                onNotesChange(e.target.value);
              }
            }}
            className="block w-full rounded-xl border border-[#DCE4DE] bg-white px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Packaging damaged during handover."
            disabled={isSubmitting}
            maxLength={300}
          />
          {errors.notes ? (
            <p className="text-sm text-[#B3261E] mt-1">{errors.notes}</p>
          ) : null}
          {form.notes.length > 300 && (
            <p className="text-sm text-[#6B7280] mt-1">
              Notes must be at most 300 characters
            </p>
          )}
        </div>

        <button
          type="button"
          className="w-full min-h-[48px] rounded-xl border border-[#DCE4DE] bg-white text-[#1B6B46] text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-4"
          disabled={isSubmitting}
          onClick={handleFileInputClick}
        >
          Add photo (optional)
        </button>

        {selectedPhoto ? (
          <div className="mt-2 flex items-center space-x-2">
            <img
              src={selectedPhoto.preview}
              alt="Selected photo"
              className="w-8 h-8 rounded-xl object-cover"
            />
            <span className="text-sm text-foreground truncate">
              {selectedPhoto.file.name}
            </span>
          </div>
        ) : null}

        <p className="rounded-xl bg-[#EAF4EE]/60 p-4 text-sm text-[#63746D] mt-4">
          Do not include beneficiary names, home addresses, or identifiable faces.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onChange}
        />

        <div className="mt-6 space-y-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full min-h-[48px] rounded-xl bg-[#1B6B46] text-white text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Save entry
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