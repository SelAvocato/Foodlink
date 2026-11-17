import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

type PostedLabelProps = {
  foodName: string;
  shortCode: string;
  portionsText: string;
  pickupText: string;
  qrSlot: ReactNode;
};

const NEXT_STEPS = [
  "Staff accept or decline your donation.",
  "An active volunteer is assigned.",
  "The volunteer scans this label and inspects the food.",
  "Track delivery and distribution from My donations.",
];

const actionButtonClass = "w-full rounded-sm sm:w-[14.5rem]";

export function PostedLabel({
  foodName,
  shortCode,
  portionsText,
  pickupText,
  qrSlot,
}: PostedLabelProps) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-semibold sm:text-4xl">Your donation is posted</h1>
        <p className="mt-2 text-sm text-(--fl-muted)">
          {foodName} · {shortCode} · The organization can now review your donation.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[5fr_7fr]">
        <section className="rounded-2xl bg-(--fl-card) p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">FoodLink · Donation label</h2>
          <p className="mt-4 text-base text-(--fl-muted)">
            {shortCode} · {foodName}
          </p>
          <div className="mt-8 flex justify-center">{qrSlot}</div>
          <div className="mt-8 flex flex-col gap-1 text-base text-(--fl-muted)">
            <p>{portionsText}</p>
            <p>{pickupText}</p>
            <p>Keep this label ready for your volunteer.</p>
          </div>
        </section>

        <section className="flex flex-col rounded-2xl bg-(--fl-success) p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-(--fl-primary) sm:text-3xl">
            What happens next?
          </h2>
          <ol className="mt-8 list-decimal space-y-8 pl-6 text-lg sm:space-y-12">
            {NEXT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="mt-auto pt-8 text-sm text-(--fl-muted)">
            QR access is limited to you, staff, and the assigned volunteer. No raw
            donation IDs are encoded in the QR.
          </p>
        </section>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-4 sm:flex-row">
          <Button type="button" variant="outline" className={actionButtonClass}>
            Print label
          </Button>
          <Button type="button" variant="outline" className={actionButtonClass}>
            Save as image
          </Button>
        </div>
        <Button type="button" className={`${actionButtonClass} sm:ml-auto`}>
          Track donation
        </Button>
      </div>
    </div>
  );
}
