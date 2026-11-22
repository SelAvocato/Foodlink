"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  REQUEST_TIMEOUT_MS,
  taskCode,
} from "@/app/(volunteer)/volunteer/assigned-tasks-logic";
import { portionsText } from "@/app/(volunteer)/volunteer/assigned-tasks-mobile-logic";
import { PickupDecision, type ScreeningVerdict } from "@/contracts/enums";
import {
  UPLOAD_TIMEOUT_MS,
  canAcceptPickup,
  canConfirmRejection,
  canRejectPickup,
  canScreenStaged,
  checkPhotoFile,
  checkQuestions,
  combineReason,
  donorChecklistLine,
  errorCode,
  errorMessage,
  inspectionBody,
  outcomePanel,
  parseChecklist,
  parseOutcomeDecision,
  parsePhotoResponse,
  parseTaskDetail,
  screeningPanel,
  type Answer,
  type Answers,
  type CheckKey,
  type ChecklistState,
  type SubmitDecision,
  type TaskDetail,
} from "./pickup-inspection-logic";
import { PhoneCheckStep } from "./phone-check-step";
import { PhoneRejectStep } from "./phone-reject-step";
import { PhotoStepMobile } from "./photo-step-mobile";

const BUTTON =
  "inline-flex h-11 min-w-[210px] items-center justify-center rounded-sm px-6 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = BUTTON + " bg-[#176448] text-white enabled:hover:bg-[#12513a]";
const OUTLINE =
  BUTTON + " border border-[#DCE4DE] bg-white text-[#176448] enabled:hover:bg-[#EAF4EE]";
const STRIP = "mt-6 rounded-xl bg-[#EAF4EE] px-5 py-5 text-[15px] leading-6 text-[#885B16]";
const STRIP_ACTION =
  "mt-3 inline-flex h-11 items-center justify-center rounded-sm border border-[#885B16] px-5 text-[15px] font-semibold text-[#885B16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#885B16]";

type HeaderState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "notFound" }
  | { kind: "ready"; task: TaskDetail };

type FailureStep = "load" | "photo" | "submit" | "outcome";

type Trouble = {
  message: string;
  href: string | null;
  linkLabel: string | null;
  retry: FailureStep | null;
};

function troubleFrom(status: number, body: unknown, step: FailureStep): Trouble {
  const mapped = errorMessage(status, errorCode(body));
  return {
    message: mapped.message,
    href: mapped.href,
    linkLabel: mapped.linkLabel,
    retry: mapped.retry ? step : null,
  };
}

function networkTrouble(step: FailureStep | null): Trouble {
  return { message: "Could not reach the server.", href: null, linkLabel: null, retry: step };
}

type TaskLoad = { kind: "failed"; trouble: Trouble } | { kind: "ready"; task: TaskDetail | null };

/** The task itself; a 404 means it is not one of this volunteer's tasks. */
async function loadTask(base: string): Promise<TaskLoad> {
  try {
    const response = await fetch(base, {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: "ready", task: null };
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      return { kind: "failed", trouble: troubleFrom(response.status, body, "load") };
    }
    const task = parseTaskDetail((await response.json()) as unknown);
    if (task === null) return { kind: "failed", trouble: networkTrouble("load") };
    return { kind: "ready", task };
  } catch {
    return { kind: "failed", trouble: networkTrouble("load") };
  }
}

async function loadChecklist(base: string): Promise<ChecklistState> {
  try {
    const response = await fetch(base + "/checklist", {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return { kind: "error" };
    const checklist = parseChecklist((await response.json()) as unknown);
    return checklist === null ? { kind: "error" } : { kind: "ready", checklist };
  } catch {
    return { kind: "error" };
  }
}

export function PickupInspectionView({ donationId }: { donationId: string }) {
  const base = "/api/volunteer/donations/" + encodeURIComponent(donationId);

  const [header, setHeader] = useState<HeaderState>({ kind: "loading" });
  const [checklist, setChecklist] = useState<ChecklistState>({ kind: "loading" });
  const [answers, setAnswers] = useState<Answers>({});
  const [reason, setReason] = useState("");
  const [verdict, setVerdict] = useState<ScreeningVerdict | null>(null);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [outcome, setOutcome] = useState<PickupDecision | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [staged, setStaged] = useState(false);
  // KNOWN LIMIT: a reload returns to step "photo" because no route returns the saved photo.
  const [step, setStep] = useState<"photo" | "check" | "reject">("photo");
  const [rejectCategory, setRejectCategory] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [now] = useState(() => new Date());

  // Only the newest load may write; StrictMode's second mount reads again but wins nothing.
  const loadRun = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<string | null>(null);
  const lastFile = useRef<File | null>(null);
  const lastDecision = useRef<SubmitDecision>("accept");
  const lastReason = useRef<string | null>(null);

  // Mount and Try again only read here; the page keys this view by donation id,
  // so a new donation starts from the initial loading state.
  useEffect(() => {
    loadRun.current += 1;
    const mine = loadRun.current;

    void loadTask(base).then((result) => {
      if (loadRun.current !== mine) return;
      if (result.kind === "failed") {
        setHeader({ kind: "failed" });
        setTrouble(result.trouble);
        return;
      }
      setHeader(
        result.task === null ? { kind: "notFound" } : { kind: "ready", task: result.task },
      );
    });

    void loadChecklist(base).then((result) => {
      if (loadRun.current !== mine) return;
      setChecklist(result);
    });

    const runs = loadRun;
    return () => {
      runs.current += 1;
    };
  }, [base, donationId, refresh]);

  // The preview lives only in this visit: no route returns the saved photo.
  useEffect(() => {
    return () => {
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const task = header.kind === "ready" ? header.task : null;
  const checks = checkQuestions(task === null ? null : task.portions);
  const locked = busy || saved || outcome !== null;
  const canAccept = canAcceptPickup({
    photoUploaded,
    verdict,
    answers,
    saving: busy,
    locked: saved || outcome !== null,
  });
  const canReject = canRejectPickup({
    photoUploaded,
    reason,
    saving: busy,
    locked: saved || outcome !== null,
  });
  const panel = screeningPanel(verdict);
  const canScreen = canScreenStaged({ staged, locked });
  // The phone confirms the reason built on its own screen, so a layout change never
  // submits a reason that differs from the one shown.
  const phoneReason = combineReason(rejectCategory, rejectNote);
  const phoneCanReject = canRejectPickup({
    photoUploaded,
    reason: phoneReason,
    saving: busy,
    locked: saved || outcome !== null,
  });

  async function uploadPhoto(file: File) {
    // The old photo's verdict must not outlive a replaced preview: acceptance
    // waits until this upload has succeeded.
    setVerdict(null);
    setPhotoUploaded(false);
    setBusy(true);
    setTrouble(null);
    const form = new FormData();
    form.append("photo", file);
    try {
      const response = await fetch(base + "/photos/pickup", {
        method: "POST",
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 201) {
        const next = parsePhotoResponse(body);
        if (next === null) {
          setTrouble(networkTrouble("photo"));
          return;
        }
        setVerdict(next);
        setPhotoUploaded(true);
        setStaged(false);
        setStep("check");
        return;
      }
      setTrouble(troubleFrom(response.status, body, "photo"));
    } catch {
      setTrouble(networkTrouble("photo"));
    } finally {
      setBusy(false);
    }
  }

  async function sendOutcome() {
    try {
      const response = await fetch(base + "/pickup", {
        method: "POST",
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTrouble(troubleFrom(response.status, body, "outcome"));
        return;
      }
      const decision = parseOutcomeDecision(body);
      if (decision === null) {
        setTrouble(networkTrouble("outcome"));
        return;
      }
      setOutcome(decision);
    } catch {
      setTrouble(networkTrouble("outcome"));
    }
  }

  async function submit(decision: SubmitDecision, reasonOverride?: string) {
    // The phone passes its own reason; the desktop button passes nothing and keeps
    // using the desktop editor's reason.
    const rejectReason = reasonOverride ?? reason;
    const canRejectNow = canRejectPickup({
      photoUploaded,
      reason: rejectReason,
      saving: busy,
      locked: saved || outcome !== null,
    });
    // A retry must meet the same rules as a first click: a rejection whose reason
    // was cleared would otherwise be saved as an acceptance.
    if (decision === "reject" ? !canRejectNow : !canAccept) {
      setTrouble({
        message: "Check the photo, the answers and the reason, then try again.",
        href: null,
        linkLabel: null,
        retry: null,
      });
      return;
    }
    lastDecision.current = decision;
    lastReason.current = reasonOverride ?? null;
    setBusy(true);
    setTrouble(null);
    try {
      const response = await fetch(base + "/inspection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inspectionBody(answers, decision === "accept" ? "" : rejectReason)),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setTrouble(troubleFrom(response.status, body, "submit"));
        return;
      }
      // Saved. A failed outcome is retried on its own: the answers are locked and
      // the server refuses a second inspection once the pickup is recorded.
      setSaved(true);
      await sendOutcome();
    } catch {
      setTrouble(networkTrouble("submit"));
    } finally {
      setBusy(false);
    }
  }

  async function retryOutcome() {
    setBusy(true);
    setTrouble(null);
    try {
      await sendOutcome();
    } finally {
      setBusy(false);
    }
  }

  /** Check, replace the preview and remember the file; null when nothing usable was chosen. */
  function preparePhoto(event: ChangeEvent<HTMLInputElement>): File | null {
    const file = event.target.files?.[0] ?? null;
    // Reset so choosing the same file again still fires a change event.
    event.target.value = "";
    if (file === null) return null;
    const check = checkPhotoFile(file);
    if (!check.ok) {
      setTrouble({ message: check.message, href: null, linkLabel: null, retry: null });
      return null;
    }
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    const url = URL.createObjectURL(file);
    previewRef.current = url;
    setPreviewUrl(url);
    lastFile.current = file;
    return file;
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = preparePhoto(event);
    if (file !== null) void uploadPhoto(file);
  }

  function onPhoneFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = preparePhoto(event);
    if (file === null) return;
    setTrouble(null);
    setVerdict(null);
    setPhotoUploaded(false);
    setStaged(true);
  }

  function onScreen() {
    const file = lastFile.current;
    if (file === null) return;
    void uploadPhoto(file);
  }

  function onAnswer(key: CheckKey, value: Answer) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  function onOpenReject() {
    setStep("reject");
  }

  function onBackToInspection() {
    setStep("check");
  }

  function onRetake() {
    // The p48 step returns to the p47 preview, so the next photo is staged again
    // instead of uploaded straight away.
    if (locked) return;
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    lastFile.current = null;
    setPreviewUrl(null);
    setStaged(false);
    setVerdict(null);
    setPhotoUploaded(false);
    setTrouble(null);
    // A new photo needs fresh answers: acceptance must not carry over the old ones.
    setAnswers({});
    setStep("photo");
  }

  // A failed rejection keeps a retry of the old reason; editing the reason drops that
  // alert, so the volunteer confirms the reason now shown.
  function dropFailedRejection() {
    if (trouble !== null && trouble.retry === "submit" && lastDecision.current === "reject") {
      setTrouble(null);
    }
  }

  function onRejectCategory(category: string) {
    dropFailedRejection();
    setRejectCategory(category);
  }

  function onRejectNote(note: string) {
    dropFailedRejection();
    setRejectNote(note);
  }

  function retryFailed() {
    const step = trouble === null ? null : trouble.retry;
    if (step === "load") {
      setHeader({ kind: "loading" });
      setChecklist({ kind: "loading" });
      setTrouble(null);
      setRefresh((value) => value + 1);
      return;
    }
    if (step === "photo") {
      const file = lastFile.current;
      if (file !== null) void uploadPhoto(file);
      return;
    }
    if (step === "submit") {
      void submit(lastDecision.current, lastReason.current ?? undefined);
      return;
    }
    if (step === "outcome") void retryOutcome();
  }

  let subtitle = "Loading task...";
  if (header.kind === "ready") {
    subtitle =
      taskCode(header.task.shortCode) +
      " · " +
      header.task.foodName +
      " · " +
      header.task.portions +
      " portions · QR verified";
  } else if (header.kind === "notFound") {
    subtitle = "Donation not found";
  } else if (header.kind === "failed") {
    subtitle = "The task could not be loaded.";
  }

  const result = outcome === null ? null : outcomePanel(outcome);
  const phoneScreen = task !== null && outcome === null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1
        className={
          (phoneScreen ? "hidden md:block " : "") +
          "text-[32px] font-semibold leading-tight text-[#17261F]"
        }
      >
        Inspect before accepting pickup
      </h1>
      <p className={(phoneScreen ? "hidden md:block " : "") + "mt-2 text-[15px] text-[#63746D]"}>
        {subtitle}
      </p>

      {trouble !== null ? (
        <div role="alert" className={STRIP}>
          <p>{trouble.message}</p>
          {trouble.href !== null && trouble.linkLabel !== null ? (
            <Link href={trouble.href} className={STRIP_ACTION}>
              {trouble.linkLabel}
            </Link>
          ) : null}
          {trouble.retry !== null ? (
            <button type="button" onClick={retryFailed} className={STRIP_ACTION}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {header.kind === "notFound" ? (
        <div role="alert" className={STRIP}>
          <p>This donation is not in your assigned tasks.</p>
          <Link href="/volunteer" className={STRIP_ACTION}>
            Back to your tasks
          </Link>
        </div>
      ) : null}

      {result !== null ? (
        <section className="mt-10 rounded-xl bg-white p-6">
          <h2 className="text-[22px] font-semibold text-[#17261F]">{result.title}</h2>
          <p className="mt-3 text-[15px] text-[#63746D]">{result.body}</p>
          <Link href="/volunteer" className={OUTLINE + " mt-6"}>
            Back to your tasks
          </Link>
        </section>
      ) : null}

      {result === null && task !== null && phoneScreen ? (
        // The phone root cancels the view padding, so pad the wrapper when the
        // trouble strip above must keep its own space.
        <div className={trouble === null ? "md:hidden" : "md:hidden pt-10"}>
          {step === "photo" ? (
            <PhotoStepMobile
              code={taskCode(task.shortCode)}
              portionsLabel={portionsText(task.portions)}
              foodName={task.foodName}
              previewUrl={previewUrl}
              canScreen={canScreen}
              locked={locked}
              onFileChange={onPhoneFileChange}
              onScreen={onScreen}
            />
          ) : null}
          {step === "check" ? (
            <PhoneCheckStep
              strip={panel}
              questions={checks}
              answers={answers}
              canAccept={canAccept}
              locked={locked}
              onAnswer={onAnswer}
              onRetake={onRetake}
              onOpenReject={onOpenReject}
              onAccept={() => void submit("accept")}
            />
          ) : null}
          {step === "reject" ? (
            <PhoneRejectStep
              category={rejectCategory}
              note={rejectNote}
              canConfirm={canConfirmRejection({ category: rejectCategory, canReject: phoneCanReject })}
              locked={locked}
              onBack={onBackToInspection}
              onCategory={onRejectCategory}
              onNote={onRejectNote}
              onConfirm={() => void submit("reject", phoneReason)}
            />
          ) : null}
        </div>
      ) : null}

      {result === null && task !== null ? (
        <div
          className={(phoneScreen ? "hidden md:grid" : "grid") + " mt-10 gap-6 lg:grid-cols-2"}
        >
          <section className="flex flex-col rounded-xl bg-white p-6">
            <h2 className="text-[22px] font-semibold text-[#17261F]">Your pickup photo</h2>
            {previewUrl === null ? (
              <div className="mt-7 flex aspect-video w-full items-center justify-center rounded-xl bg-[#DCE4DE] text-sm text-[#63746D]">
                Pickup photo preview
              </div>
            ) : (
              <div
                role="img"
                aria-label="Your pickup photo preview"
                style={{ backgroundImage: "url(" + previewUrl + ")" }}
                className="mt-7 flex aspect-video w-full items-center justify-center rounded-xl bg-[#DCE4DE] bg-cover bg-center text-sm text-[#63746D]"
              />
            )}
            <p className="mt-3 text-[13px] text-[#63746D]">
              Illustrative pickup photo · Separate from the donor photo
            </p>
            <div className="mt-6 rounded-xl bg-[#EAF4EE] px-4 py-4 text-[15px] leading-6 text-[#176448]">
              <p>{panel.title}</p>
              {panel.body !== null ? <p>{panel.body}</p> : null}
            </div>
            <div className="mt-9">
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Pickup photo"
                onChange={onFileChange}
                disabled={locked}
                className="sr-only"
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => fileInput.current?.click()}
                className={OUTLINE}
              >
                {photoUploaded ? "Retake photo" : "Choose photo"}
              </button>
              <p className="mt-2 text-[13px] text-[#63746D]">Up to 4 MB</p>
            </div>
          </section>

          <section className="flex flex-col rounded-xl bg-white p-6">
            <h2 className="text-[22px] font-semibold text-[#17261F]">
              All three checks must be Yes
            </h2>
            <div className="mt-7 flex flex-col gap-5">
              {checks.map((check) => (
                <div key={check.key} className="min-h-[106px] rounded-lg bg-[#F5F7F5] p-4">
                  <p id={"check-" + check.key} className="text-[15px] text-[#17261F]">
                    {check.question}
                  </p>
                  <div
                    role="radiogroup"
                    aria-labelledby={"check-" + check.key}
                    className="mt-6 flex items-center gap-14"
                  >
                    {(["yes", "no"] as const).map((value) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-center gap-2 text-sm text-[#17261F]"
                      >
                        <input
                          type="radio"
                          name={check.key}
                          value={value}
                          checked={answers[check.key] === value}
                          onChange={() => setAnswers((prev) => ({ ...prev, [check.key]: value }))}
                          disabled={locked}
                          className="size-4 accent-[#176448]"
                        />
                        {value === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-9 text-[15px] text-[#885B16]">
              When unsure, reject pickup. FLAG or any No disables acceptance.
            </p>
            <div className="mt-5">
              <label htmlFor="reject-reason" className="text-sm font-medium text-[#17261F]">
                Reason for rejecting (required to reject)
              </label>
              <textarea
                id="reject-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={locked}
                className="mt-2 block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-[15px] text-[#17261F] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#176448]"
              />
            </div>
            <div className="mt-6 flex flex-wrap gap-6">
              <button
                type="button"
                disabled={!canAccept}
                onClick={() => void submit("accept")}
                className={PRIMARY}
              >
                Accept pickup
              </button>
              <button
                type="button"
                disabled={!canReject}
                onClick={() => void submit("reject")}
                className={OUTLINE}
              >
                Reject pickup
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <p
        className={
          (phoneScreen && step !== "check" ? "hidden md:block " : "") +
          "mt-9 text-[15px] text-[#63746D]"
        }
      >
        {donorChecklistLine(checklist, now)}
      </p>
    </div>
  );
}
