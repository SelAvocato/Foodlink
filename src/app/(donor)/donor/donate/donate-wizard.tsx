"use client";

import { useState } from "react";
import { DonateGuide } from "./donate-guide";
import { PhotoStep } from "./photo-step";

type Step = "guide" | "photo";

export function DonateWizard() {
  const [step, setStep] = useState<Step>("guide");

  const handleStart = () => {
    setStep("photo");
    window.scrollTo({ top: 0 });
  };

  if (step === "photo") {
    return <PhotoStep />;
  }

  return (
    <DonateGuide donorLabel="Establishment donor" onStart={handleStart} />
  );
}
