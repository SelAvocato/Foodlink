"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { errorCodeFrom } from "./photo-step-logic";
import {
  allergenLabel,
  buildChecklistBody,
  deriveInitialForm,
  missingMessages,
  messageForChecklistError,
  parseChecklistLoad,
  parseSaveResponse,
  shelfLifeMessage,
  toggleAllergen,
  toggleNone,
  type AllergenOption,
  type ChecklistForm,
  type ChecklistLoad,
} from "./checklist-logic";
import { WizardProgress } from "./wizard-progress";

const STORAGE_CONDITIONS = [
  { value: "ROOM_TEMPERATURE", label: "Room temperature" },
  { value: "HOT_HELD", label: "Hot held" },
  { value: "REFRIGERATED", label: "Refrigerated" },
  { value: "FROZEN", label: "Frozen" },
];

type ChecklistStepProps = {
  categoryName: string;
  /** The category code, for the five-month shelf-life rule (sealed food and beverages). */
  categoryCode: string;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
  donationId: string;
  /** The allergens the resumed draft already has; a fresh pass starts with none. */
  initialAllergenCodes: string[];
  allergens: AllergenOption[];
  /** Opens the details step; only a complete save calls it, with the allergens it just sent. */
  onComplete: (allergenCodes: string[]) => void;
};

type SaveOutcome =
  | { kind: "incomplete"; missing: string[] }
  | { kind: "error"; message: string };

const checkboxClass = "size-4 shrink-0 accent-(--fl-primary)";

export function ChecklistStep({
  categoryName,
  categoryCode,
  requiresPreparedTime,
  requiresStorageInfo,
  donationId,
  initialAllergenCodes,
  allergens,
  onComplete,
}: ChecklistStepProps) {
  const notApplicable = `Not applicable · ${categoryName} selected`;
  const [form, setForm] = useState<ChecklistForm>(() =>
    deriveInitialForm({ checklist: null, allergenCodes: initialAllergenCodes }),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [saved, setSaved] = useState(false);
  // The shelf-life refusal sits under the field it is about, not in the banner.
  const [consumeByError, setConsumeByError] = useState<string | null>(null);
  // Bumped when a load starts over: an answer that began earlier is stale.
  const loadRunRef = useRef(0);

  const fetchChecklist = useCallback(async (): Promise<ChecklistLoad> => {
    try {
      const response = await fetch(`/api/donor/drafts/${donationId}/checklist`);
      if (!response.ok) return { ok: false };
      const body: unknown = await response.json();
      return parseChecklistLoad(body);
    } catch {
      return { ok: false };
    }
  }, [donationId]);

  const applyChecklistLoad = useCallback(
    (result: ChecklistLoad) => {
      if (!result.ok) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      setForm(
        deriveInitialForm({ checklist: result.checklist, allergenCodes: initialAllergenCodes }),
      );
      setLoadError(false);
      setLoading(false);
    },
    [initialAllergenCodes],
  );

  // Fetching and applying stay separate so the effect never calls setState
  // synchronously (react-hooks/set-state-in-effect); everything lands in .then.
  const launchLoad = useCallback(() => {
    loadRunRef.current += 1;
    const run = loadRunRef.current;
    void fetchChecklist().then((result) => {
      if (loadRunRef.current === run) applyChecklistLoad(result);
    });
  }, [fetchChecklist, applyChecklistLoad]);

  useEffect(() => {
    launchLoad();
    // An unmount (or a changed draft) makes every answer in flight stale.
    return () => {
      loadRunRef.current += 1;
    };
  }, [launchLoad]);

  function retryLoad() {
    setLoading(true);
    setLoadError(false);
    launchLoad();
  }

  /** Save order: the allergens first, then the checklist. A retry repeats both. */
  async function handleContinue() {
    if (saving) return;
    // Checked first: a refused checklist must not even patch the allergens.
    const shelfLife = shelfLifeMessage(form, categoryCode, new Date());
    setConsumeByError(shelfLife);
    if (shelfLife !== null) return;
    // Captured before the first await: what the PATCH sends is what the wizard keeps.
    const allergenCodes = [...form.allergenCodes];
    setSaving(true);
    setOutcome(null);
    try {
      const patched = await fetch(`/api/donor/drafts/${donationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allergenCodes }),
      });
      if (!patched.ok) {
        setSaved(false);
        setOutcome({
          kind: "error",
          message: messageForChecklistError(
            errorCodeFrom(await patched.json().catch(() => null)),
          ),
        });
        return;
      }

      const stored = await fetch(`/api/donor/drafts/${donationId}/checklist`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildChecklistBody(form, { requiresPreparedTime, requiresStorageInfo }),
        ),
      });
      if (!stored.ok) {
        setSaved(false);
        setOutcome({
          kind: "error",
          message: messageForChecklistError(errorCodeFrom(await stored.json().catch(() => null))),
        });
        return;
      }

      const parsed = parseSaveResponse(await stored.json().catch(() => null));
      if (parsed === null) {
        setSaved(false);
        setOutcome({ kind: "error", message: messageForChecklistError(undefined) });
        return;
      }
      setSaved(true);
      // The details step is the next one; only a complete checklist opens it.
      if (parsed.complete) {
        onComplete(allergenCodes);
        return;
      }
      setOutcome({ kind: "incomplete", missing: parsed.missing });
    } catch {
      // Network failure: nothing about the allergen patch is reported, a retry repeats it.
      setSaved(false);
      setOutcome({ kind: "error", message: messageForChecklistError(undefined) });
    } finally {
      setSaving(false);
    }
  }

  /** An edit makes any earlier save result stale, so its banner and footer go. */
  function updateForm(change: (current: ChecklistForm) => ChecklistForm) {
    setForm(change);
    setOutcome(null);
    setSaved(false);
    setConsumeByError(null);
  }

  const fieldsDisabled = loading || loadError || saving;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Confirm food safety</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          All checklist fields must be completed before you continue.
        </p>
      </header>

      <WizardProgress currentStep={2} />

      <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:max-w-[85%]">
        {loadError ? (
          <FeedbackBanner
            tone="error"
            title="Could not load your checklist"
            action={{ label: "Try again", onClick: retryLoad }}
            className="mb-6"
          />
        ) : null}

        <h2 className="text-2xl font-semibold">2. Human safety checklist</h2>
        <p className="mt-3 text-base text-(--fl-primary)">
          Photo screening: Pass · A visual aid, not a food safety guarantee.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="prepared-at">Time prepared (cooked meals &amp; bakery)</Label>
            {requiresPreparedTime ? (
              <Input
                id="prepared-at"
                type="datetime-local"
                className="rounded-sm"
                value={form.preparedAt}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, preparedAt: event.target.value }))
                }
              />
            ) : (
              <Input id="prepared-at" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="consume-by-at">Consume-by / expiry</Label>
            <Input
              id="consume-by-at"
              type="datetime-local"
              className="rounded-sm"
              value={form.consumeByAt}
              disabled={fieldsDisabled}
              aria-invalid={consumeByError !== null}
              aria-describedby={consumeByError === null ? undefined : "consume-by-error"}
              onChange={(event) =>
                updateForm((current) => ({ ...current, consumeByAt: event.target.value }))
              }
            />
            {consumeByError === null ? null : (
              <p id="consume-by-error" role="alert" className="text-sm text-destructive">
                {consumeByError}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="storage-condition">Storage condition (cooked meals)</Label>
            {requiresStorageInfo ? (
              <Select
                id="storage-condition"
                className="rounded-sm"
                value={form.storageCondition}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, storageCondition: event.target.value }))
                }
              >
                <option value="" disabled>
                  Choose a condition
                </option>
                {STORAGE_CONDITIONS.map((condition) => (
                  <option key={condition.value} value={condition.value}>
                    {condition.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="storage-condition" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="storage-temperature">Temperature °C (cooked meals)</Label>
            {requiresStorageInfo ? (
              <Input
                id="storage-temperature"
                className="rounded-sm"
                type="number"
                inputMode="decimal"
                min={-50}
                max={100}
                step={0.1}
                value={form.storageTemperature}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, storageTemperature: event.target.value }))
                }
              />
            ) : (
              <Input id="storage-temperature" value={notApplicable} disabled readOnly className="rounded-sm" />
            )}
          </div>
        </div>

        <fieldset className="mt-8">
          <legend className="text-base font-semibold">Allergens declared</legend>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            {allergens.map((allergen) => (
              <label
                key={allergen.code}
                htmlFor={`allergen-${allergen.code}`}
                className="flex items-center gap-2 text-base text-(--fl-muted)"
              >
                <input
                  id={`allergen-${allergen.code}`}
                  type="checkbox"
                  className={checkboxClass}
                  checked={form.allergenCodes.includes(allergen.code)}
                  disabled={fieldsDisabled}
                  onChange={() => updateForm((current) => toggleAllergen(current, allergen.code))}
                />
                {allergenLabel(allergen)}
              </label>
            ))}
            <label
              htmlFor="allergen-none"
              className="flex items-center gap-2 text-base text-(--fl-muted)"
            >
              <input
                id="allergen-none"
                type="checkbox"
                className={checkboxClass}
                checked={form.noneSelected}
                disabled={fieldsDisabled}
                onChange={() => updateForm((current) => toggleNone(current))}
              />
              None
            </label>
          </div>
        </fieldset>

        <div className="mt-8 flex flex-col gap-4">
          <label htmlFor="packaging-intact" className="flex items-center gap-2 text-base">
            <input
              id="packaging-intact"
              type="checkbox"
              className={checkboxClass}
              checked={form.packagingIntact}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({ ...current, packagingIntact: event.target.checked }))
              }
            />
            Packaging is intact and clean.
          </label>
          <label htmlFor="not-plate-leftovers" className="flex items-center gap-2 text-base">
            <input
              id="not-plate-leftovers"
              type="checkbox"
              className={checkboxClass}
              checked={form.notCustomerPlateLeftovers}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({
                  ...current,
                  notCustomerPlateLeftovers: event.target.checked,
                }))
              }
            />
            Food is not opened, partially eaten, or plate leftovers.
          </label>
        </div>

        <p className="mt-8 text-sm text-(--fl-muted)">
          Prepared time and temperature appear only when applicable to the category.
        </p>

        {outcome === null ? null : outcome.kind === "incomplete" ? (
          <FeedbackBanner tone="warning" title="Checklist not complete yet" className="mt-8">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {missingMessages(outcome.missing).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </FeedbackBanner>
        ) : (
          <FeedbackBanner tone="error" title="Could not save the checklist" className="mt-8">
            {outcome.message}
          </FeedbackBanner>
        )}

        <div className="mt-10 flex flex-wrap gap-4">
          <Button
            type="button"
            className="w-full rounded-sm sm:w-[14.5rem]"
            disabled={fieldsDisabled}
            onClick={() => void handleContinue()}
          >
            Continue
          </Button>
        </div>
      </section>

      {saved ? <p className="text-sm text-(--fl-muted)">Draft saved</p> : null}
    </div>
  );
}
