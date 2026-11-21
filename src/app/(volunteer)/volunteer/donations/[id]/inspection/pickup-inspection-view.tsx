"use client";

import { useState } from "react";

type Answer = "yes" | "no";
type CheckKey = "matches" | "packaging" | "looks";

// Static layer: sample data only. The wiring step replaces it with real data.
const SAMPLE = {
  code: "#A1B2C3D4",
  food: "Vegetable rice bowls",
  portions: 40,
  screening: "Pass",
  donorChecklist:
    "Donor checklist: Prepared 9:00 AM · Consume by 6:00 PM · Hot-held at 63°C · Soy declared · Packaging clean · Not opened or leftover",
};

const CHECKS: { key: CheckKey; question: string }[] = [
  {
    key: "matches",
    question: "Does it match the description and " + SAMPLE.portions + " portions?",
  },
  { key: "packaging", question: "Is the packaging sealed and clean?" },
  { key: "looks", question: "Does it look and smell normal?" },
];

const BUTTON =
  "inline-flex h-11 min-w-[210px] items-center justify-center rounded-sm px-6 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = BUTTON + " bg-[#176448] text-white enabled:hover:bg-[#12513a]";
const OUTLINE =
  BUTTON + " border border-[#DCE4DE] bg-white text-[#176448] enabled:hover:bg-[#EAF4EE]";

export function PickupInspectionView() {
  const [answers, setAnswers] = useState<Partial<Record<CheckKey, Answer>>>({});
  const [reason, setReason] = useState("");

  const allYes = CHECKS.every((check) => answers[check.key] === "yes");
  const canReject = reason.trim().length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <h1 className="text-[32px] font-semibold leading-tight text-[#17261F]">
        Inspect before accepting pickup
      </h1>
      <p className="mt-2 text-[15px] text-[#63746D]">
        {SAMPLE.code} · {SAMPLE.food} · {SAMPLE.portions} portions · QR verified
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col rounded-xl bg-white p-6">
          <h2 className="text-[22px] font-semibold text-[#17261F]">Your pickup photo</h2>
          <div className="mt-7 flex aspect-video w-full items-center justify-center rounded-xl bg-[#DCE4DE] text-sm text-[#63746D]">
            Pickup photo preview
          </div>
          <p className="mt-3 text-[13px] text-[#63746D]">
            Illustrative pickup photo · Separate from the donor photo
          </p>
          <div className="mt-6 rounded-xl bg-[#EAF4EE] px-4 py-4 text-[15px] leading-6 text-[#176448]">
            <p>Photo screening: {SAMPLE.screening}</p>
            <p>A visual aid only. Your inspection is the final gate.</p>
          </div>
          <div className="mt-9">
            <button type="button" className={OUTLINE}>
              Retake photo
            </button>
          </div>
        </section>

        <section className="flex flex-col rounded-xl bg-white p-6">
          <h2 className="text-[22px] font-semibold text-[#17261F]">
            All three checks must be Yes
          </h2>
          <div className="mt-7 flex flex-col gap-5">
            {CHECKS.map((check) => (
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
              className="mt-2 block w-full rounded-sm border border-[#DCE4DE] bg-white px-3 py-2 text-[15px] text-[#17261F] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#176448]"
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-6">
            <button type="button" disabled={!allYes} className={PRIMARY}>
              Accept pickup
            </button>
            <button type="button" disabled={!canReject} className={OUTLINE}>
              Reject pickup
            </button>
          </div>
        </section>
      </div>

      <p className="mt-9 text-[15px] text-[#63746D]">{SAMPLE.donorChecklist}</p>
    </div>
  );
}
