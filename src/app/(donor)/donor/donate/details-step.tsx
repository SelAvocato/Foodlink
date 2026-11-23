"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { LocationPicker, type FlyTarget, type MapPoint } from "@/components/map/location-picker";
import { FeedbackBanner } from "@/components/shared/feedback-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatPin,
  locationFailureMessage,
  LOCATION_UNSUPPORTED_MESSAGE,
  roundPin,
} from "@/lib/map-pin";
import { parseChecklistLoad } from "./checklist-logic";
import { errorCodeFrom } from "./photo-step-logic";
import {
  buildDraftPatch,
  buildPickupBody,
  deriveInitialDetails,
  EMPTY_CARRIED,
  initialDetailsForm,
  messageForDetailsError,
  parseDraftDetails,
  parseProfileAddress,
  parsePickupLoad,
  parseSaveResponse,
  rulesFor,
  validateDetails,
  type CarriedAddress,
  type ChecklistTimes,
  type DetailsErrors,
  type DetailsForm,
  type ProfileAddress,
} from "./details-logic";
import { WizardProgress } from "./wizard-progress";

type DetailsStepProps = {
  donationId: string;
  categoryName: string;
  donorLabel: string;
  /** Back returns to the checklist. */
  onBack: () => void;
  /** Called once the draft and the pickup are both saved; the step stays where it is. */
  onSaved: () => void;
};

type SaveOutcome = { kind: "success" } | { kind: "error"; message: string };

/** What one load answers: everything the form starts from, or nothing at all. */
type LoadedDetails = {
  form: DetailsForm;
  pin: MapPoint | null;
  carried: CarriedAddress;
  checklistTimes: ChecklistTimes;
};

/** The parsed JSON body, or null when the request or the answer itself failed. */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** The two ARIA attributes an input needs while its error line is shown. */
function ariaFor(id: string, error: string | undefined) {
  if (error === undefined) return {};
  return { "aria-invalid": true, "aria-describedby": `${id}-error` };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function DetailsStep({
  donationId,
  categoryName,
  donorLabel,
  onBack,
  onSaved,
}: DetailsStepProps) {
  const [form, setForm] = useState<DetailsForm>(initialDetailsForm);
  const [pin, setPin] = useState<MapPoint | null>(null);
  const [carried, setCarried] = useState<CarriedAddress>(EMPTY_CARRIED);
  const [checklistTimes, setChecklistTimes] = useState<ChecklistTimes>({
    consumeByAt: null,
    preparedAt: null,
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [saved, setSaved] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  // Bumped on every manual map pick, so a slower geolocation answer cannot overwrite it.
  const pickVersion = useRef(0);
  // Read inside the map and geolocation callbacks, where the saving state is stale.
  const savingRef = useRef(false);
  // Bumped when a load starts over: an answer that began earlier is stale.
  const loadRunRef = useRef(0);

  // The profile is only worth asking for when there is no saved pickup to copy from.
  const loadDetails = useCallback(async (): Promise<LoadedDetails | null> => {
    try {
      const [draftsBody, pickupBody, checklistBody] = await Promise.all([
        fetchJson("/api/donor/drafts"),
        fetchJson(`/api/donor/drafts/${donationId}/pickup`),
        fetchJson(`/api/donor/drafts/${donationId}/checklist`),
      ]);
      if (draftsBody === null || pickupBody === null || checklistBody === null) return null;

      const draft = parseDraftDetails(draftsBody, donationId);
      const pickup = parsePickupLoad(pickupBody);
      const checklist = parseChecklistLoad(checklistBody);
      if (draft === null || !pickup.ok || !checklist.ok) return null;

      let profile: ProfileAddress | null = null;
      if (pickup.pickup === null) {
        const profileBody = await fetchJson("/api/donor/profile");
        if (profileBody === null) return null;
        profile = parseProfileAddress(profileBody);
        if (profile === null) return null;
      }

      const initial = deriveInitialDetails({ draft, pickup: pickup.pickup, profile });
      return {
        form: initial.form,
        pin: initial.pin,
        carried: initial.carried,
        checklistTimes: {
          consumeByAt: checklist.checklist?.consumeByAt ?? null,
          preparedAt: checklist.checklist?.preparedAt ?? null,
        },
      };
    } catch {
      return null;
    }
  }, [donationId]);

  const applyLoad = useCallback((result: LoadedDetails | null) => {
    if (result === null) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setForm(result.form);
    setPin(result.pin);
    setCarried(result.carried);
    setChecklistTimes(result.checklistTimes);
    setErrors({});
    setLoadError(false);
    setLoading(false);
  }, []);

  // Fetching and applying stay separate so the effect never calls setState
  // synchronously (react-hooks/set-state-in-effect); everything lands in .then.
  const launchLoad = useCallback(() => {
    loadRunRef.current += 1;
    const run = loadRunRef.current;
    void loadDetails().then((result) => {
      if (loadRunRef.current === run) applyLoad(result);
    });
  }, [loadDetails, applyLoad]);

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
    setOutcome(null);
    setSaved(false);
    launchLoad();
  }

  /** Save order: the draft first, then the whole pickup. A retry repeats both. */
  async function handleContinue() {
    if (saving || loading || loadError) return;

    const found = validateDetails(form, checklistTimes.consumeByAt, new Date());
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    // Both bodies are built before the first request, so what is sent is what was validated.
    const patch = buildDraftPatch(form);
    const pickup = buildPickupBody(form, carried, pin);
    if (pickup === null) {
      setOutcome({ kind: "error", message: messageForDetailsError(undefined) });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setOutcome(null);
    setSaved(false);
    try {
      const patched = await fetch(`/api/donor/drafts/${donationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!patched.ok) {
        setOutcome({
          kind: "error",
          message: messageForDetailsError(errorCodeFrom(await patched.json().catch(() => null))),
        });
        return;
      }

      const stored = await fetch(`/api/donor/drafts/${donationId}/pickup`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pickup),
      });
      if (!stored.ok) {
        setOutcome({
          kind: "error",
          message: messageForDetailsError(errorCodeFrom(await stored.json().catch(() => null))),
        });
        return;
      }

      const parsed = parseSaveResponse(await stored.json().catch(() => null));
      if (parsed === null) {
        setOutcome({ kind: "error", message: messageForDetailsError(undefined) });
        return;
      }

      setSaved(true);
      setOutcome({ kind: "success" });
      onSaved();
    } catch {
      // Network failure: the draft may already be saved, so a retry repeats both.
      setOutcome({ kind: "error", message: messageForDetailsError(undefined) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  /** An edit makes any earlier save result stale, so its banner and footer go. */
  function updateForm(change: (current: DetailsForm) => DetailsForm) {
    setForm(change);
    setOutcome(null);
    setSaved(false);
  }

  function placePin(point: MapPoint) {
    // A pin that changes mid-save would leave "Draft saved" describing a pin the server never got.
    if (savingRef.current) return;
    // The column keeps 6 decimals (numeric(9,6)); round here so what is shown is what is saved.
    setPin(roundPin(point));
    setOutcome(null);
    setSaved(false);
  }

  function pickOnMap(point: MapPoint) {
    if (savingRef.current) return;
    pickVersion.current += 1;
    // A manual pick replaces any earlier "move the map" command, so reopening the picker starts at this pin.
    setFlyTo(null);
    placePin(point);
  }

  function locateMe() {
    if (locating) return;
    if (!("geolocation" in navigator)) {
      setLocationMessage(LOCATION_UNSUPPORTED_MESSAGE);
      return;
    }
    setLocating(true);
    setLocationMessage(null);
    const startedAt = pickVersion.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setLocating(false);
        // The donor picked a point on the map while this lookup was running; keep that pick.
        if (pickVersion.current !== startedAt) return;
        if (savingRef.current) return;
        placePin(point);
        setFlyTo({ ...point, id: Date.now() });
      },
      (failure) => {
        setLocating(false);
        if (pickVersion.current !== startedAt) return;
        setLocationMessage(locationFailureMessage(failure.code));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  const fieldsDisabled = loading || loadError || saving;
  const rules = rulesFor(form, checklistTimes);
  const allMet = rules.every((rule) => rule.met);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Tell us about the donation</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          Use whole portions and a pickup window before the consume-by time.
        </p>
      </header>

      <WizardProgress currentStep={3} />

      <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8 lg:max-w-[85%]">
        {loadError ? (
          <FeedbackBanner
            tone="error"
            title="Could not load your details"
            action={{ label: "Try again", onClick: retryLoad }}
            className="mb-6"
          />
        ) : null}

        <h2 className="text-2xl font-semibold">3. Donation details</h2>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="food-name">Food name</Label>
            <Input
              id="food-name"
              className="rounded-sm"
              type="text"
              maxLength={160}
              autoComplete="off"
              value={form.foodName}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({ ...current, foodName: event.target.value }))
              }
              {...ariaFor("food-name", errors.foodName)}
            />
            <FieldError id="food-name" message={errors.foodName} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="category">Category · {donorLabel}</Label>
            <Input id="category" className="rounded-sm" value={categoryName} disabled readOnly />
            <p className="text-xs text-(--fl-muted)">Chosen in step 1.</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pickup-start">Pickup starts · Must be in the future</Label>
            <Input
              id="pickup-start"
              className="rounded-sm"
              type="datetime-local"
              value={form.pickupStart}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({ ...current, pickupStart: event.target.value }))
              }
              {...ariaFor("pickup-start", errors.pickupStart)}
            />
            <FieldError id="pickup-start" message={errors.pickupStart} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pickup-end">Pickup ends · Before consume-by</Label>
            <Input
              id="pickup-end"
              className="rounded-sm"
              type="datetime-local"
              value={form.pickupEnd}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({ ...current, pickupEnd: event.target.value }))
              }
              {...ariaFor("pickup-end", errors.pickupEnd)}
            />
            <FieldError id="pickup-end" message={errors.pickupEnd} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="portions">Portions · Whole number, minimum 1</Label>
            <Input
              id="portions"
              className="rounded-sm"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={form.portions}
              disabled={fieldsDisabled}
              onChange={(event) =>
                updateForm((current) => ({ ...current, portions: event.target.value }))
              }
              {...ariaFor("portions", errors.portions)}
            />
            <FieldError id="portions" message={errors.portions} />
          </div>

          <div className="hidden sm:block" aria-hidden="true" />

          <fieldset className="grid gap-6 sm:col-span-2 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-medium">Pickup address</legend>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="pickup-street">Street address</Label>
              <Input
                id="pickup-street"
                className="rounded-sm"
                type="text"
                maxLength={200}
                value={form.streetLine1}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, streetLine1: event.target.value }))
                }
                {...ariaFor("pickup-street", errors.streetLine1)}
              />
              <FieldError id="pickup-street" message={errors.streetLine1} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pickup-barangay">Barangay (optional)</Label>
              <Input
                id="pickup-barangay"
                className="rounded-sm"
                type="text"
                maxLength={120}
                value={form.barangay}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, barangay: event.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="pickup-city">City</Label>
              <Input
                id="pickup-city"
                className="rounded-sm"
                type="text"
                maxLength={120}
                value={form.city}
                disabled={fieldsDisabled}
                onChange={(event) =>
                  updateForm((current) => ({ ...current, city: event.target.value }))
                }
                {...ariaFor("pickup-city", errors.city)}
              />
              <FieldError id="pickup-city" message={errors.city} />
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 sm:col-span-2">
            <span className="text-sm font-medium">Pickup map pin (optional)</span>
            <div className="flex flex-col gap-3 rounded-sm border border-input px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base text-(--fl-muted)">
                {pin === null ? "No pin set yet" : `Pin set: ${formatPin(pin)}`}
              </p>
              <Button
                type="button"
                variant="outline"
                className="rounded-sm"
                aria-expanded={mapOpen}
                disabled={fieldsDisabled}
                onClick={() => setMapOpen((open) => !open)}
              >
                {mapOpen ? "Close map" : "Set location on map"}
              </Button>
            </div>
            {mapOpen ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-(--fl-muted)">Tap or click the map to place the pin.</p>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-sm"
                  disabled={locating || loading || saving}
                  onClick={locateMe}
                >
                  {locating ? "Finding your location..." : "Use my current location"}
                </Button>
                {locationMessage ? (
                  <p role="alert" className="text-sm text-destructive">
                    {locationMessage}
                  </p>
                ) : null}
                <div className="overflow-hidden rounded-lg border border-input">
                  <LocationPicker value={pin} flyTo={flyTo} onPick={pickOnMap} />
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <ul
          className={`mt-8 flex flex-col gap-2 rounded-sm p-5 text-base ${
            allMet
              ? "bg-(--fl-success) text-(--fl-primary)"
              : "bg-(--fl-warning) text-[#885B16]"
          }`}
        >
          {rules.map((rule) => (
            <li key={rule.text} className="flex items-start gap-2">
              {rule.met ? (
                <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-2.5 size-1.5 shrink-0 rounded-full bg-current"
                />
              )}
              <span className="sr-only">{rule.met ? "Met: " : "Not met: "}</span>
              <span>{rule.text}</span>
            </li>
          ))}
        </ul>

        {outcome === null || outcome.kind === "success" ? null : (
          <FeedbackBanner tone="error" title="Could not save the details" className="mt-8">
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
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-sm sm:w-[14.5rem]"
            disabled={saving}
            onClick={onBack}
          >
            Back
          </Button>
        </div>
      </section>

      <p className="text-sm text-(--fl-muted)">
        Individuals can select only sealed packaged food, sealed beverages, or whole
        fresh produce.
      </p>

      {saved ? <p className="text-sm text-(--fl-muted)">Draft saved</p> : null}
    </div>
  );
}
