"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Answer, Answers, CheckKey, ScreeningPanel } from "./pickup-inspection-logic";

const FULL_BUTTON = "h-[52px] w-full rounded-sm text-base font-semibold";

const OPTION =
  "flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-sm border text-body transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";
const IDLE = "border-transparent bg-[#F5F7F5] text-muted-foreground";
const YES_ON = "border-[#176448]/30 bg-[#D8ECE1] font-semibold text-primary";
const NO_ON = "border-[#B23D37]/30 bg-[#F8D9D6] font-semibold text-[#B23D37]";

/**
 * Figma p48: the phone body for step 3. Nothing is preselected; rejecting opens
 * the p49 screen.
 */
export function PhoneCheckStep({
  strip,
  questions,
  answers,
  canAccept,
  locked,
  onAnswer,
  onRetake,
  onOpenReject,
  onAccept,
}: {
  strip: ScreeningPanel;
  questions: { key: CheckKey; question: string }[];
  answers: Answers;
  canAccept: boolean;
  locked: boolean;
  onAnswer: (key: CheckKey, value: Answer) => void;
  onRetake: () => void;
  onOpenReject: () => void;
  onAccept: () => void;
}) {
  return (
    // The view pads itself px-6 py-8; cancel that so the page padding comes only
    // from the layout, as on p44, p45 and p47.
    <div className="-mx-6 -my-8">
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-display font-semibold text-foreground">Inspect before pickup</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Step 3 of 3 · All three answers must be Yes
        </p>

        <div className="mt-7 rounded-md bg-success px-4 py-5 text-body text-primary">
          <p>{strip.title}</p>
          {strip.body !== null ? <p>{strip.body}</p> : null}
        </div>

        <div className="mt-7 flex flex-col gap-6">
          {questions.map((check) => (
            <div key={check.key} className="rounded-lg bg-card p-4">
              <p id={"phone-check-" + check.key} className="text-body text-foreground">
                {check.question}
              </p>
              <div
                role="radiogroup"
                aria-labelledby={"phone-check-" + check.key}
                className="mt-4 flex gap-3"
              >
                {(["yes", "no"] as const).map((value) => {
                  const selected = answers[check.key] === value;
                  const tone = selected ? (value === "yes" ? YES_ON : NO_ON) : IDLE;
                  return (
                    <label
                      key={value}
                      className={OPTION + " " + tone + (locked ? " cursor-not-allowed opacity-60" : "")}
                    >
                      <input
                        type="radio"
                        name={"phone-" + check.key}
                        value={value}
                        checked={selected}
                        onChange={() => onAnswer(check.key, value)}
                        disabled={locked}
                        className="sr-only"
                      />
                      {selected && value === "yes" ? <Check aria-hidden className="size-4" /> : null}
                      {value === "yes" ? "Yes" : "No"}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-body text-[#885B16]">Unsure? Reject pickup. Do not take the food.</p>

        <Button
          className={
            FULL_BUTTON +
            " mt-7 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
          }
          disabled={!canAccept}
          onClick={onAccept}
        >
          Accept pickup
        </Button>
        <Button
          variant="outline"
          className={FULL_BUTTON + " mt-4 text-primary"}
          disabled={locked}
          onClick={onOpenReject}
        >
          Reject pickup
        </Button>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={locked}
            onClick={onRetake}
            className="min-h-11 px-3 text-body font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Retake photo
          </button>
        </div>
      </div>
    </div>
  );
}
