import { DonationStatus, StorageCondition } from "@/contracts/enums";
import { statusLabel } from "@/app/(donor)/donor/donations/donations-logic";
import { formatWindow } from "@/app/(donor)/donor/donate/review-logic";
import type { Crumb } from "@/components/shared/breadcrumb";
import {
  buildJourney,
  foodSafetyLines,
  pickupCountdown,
  shortCode,
  statusTone,
  trackingActions,
  volunteerText,
  type TrackingReport,
} from "./tracking-logic";
import { TrackingView } from "./tracking-view";

const TIME_ZONE = "Asia/Manila";
const SAMPLE_ID = "9fc03951-0000-4000-8000-000000000000";
/** A fixed instant inside the sample pickup window. */
const NOW = new Date("2026-11-20T15:30:00+08:00");
const ADDRESS = "18 Sample Street, Sample Barangay, Sample City";

// Temporary sample; removed when the screen is wired to GET /api/donor/donations/[id].
const SAMPLE_REPORT: TrackingReport = {
  donation: {
    status: DonationStatus.ASSIGNED,
    food_name: "Sample vegetable rice bowls",
    category: "Bakery",
    portions: 24,
    closed_at: null,
  },
  volunteer: { first_name: "Sample", phone: null },
  pickup: {
    pickup_start: "2026-11-20T15:00:00+08:00",
    pickup_end: "2026-11-20T17:00:00+08:00",
  },
  safety_checklist: {
    prepared_at: "2026-11-19T08:00:00+08:00",
    consume_by_at: "2026-11-21T12:00:00+08:00",
    storage_condition: StorageCondition.REFRIGERATED,
    storage_temperature_c: 4,
    packaging_intact: true,
    completed_at: "2026-11-19T08:30:00+08:00",
  },
  allergens: ["Soy"],
  exit: null,
  distribution: { entries: [] },
  impact: { portions_donated: 24, portions_distributed: 0 },
  timeline: [
    {
      type: "TRANSITION",
      from: DonationStatus.SCREENED,
      to: DonationStatus.POSTED,
      at: "2026-11-19T09:00:00+08:00",
    },
    {
      type: "TRANSITION",
      from: DonationStatus.POSTED,
      to: DonationStatus.ACCEPTED,
      at: "2026-11-19T10:15:00+08:00",
    },
    {
      type: "TRANSITION",
      from: DonationStatus.ACCEPTED,
      to: DonationStatus.ASSIGNED,
      at: "2026-11-20T08:00:00+08:00",
    },
  ],
};

export default function DonationTrackingPage() {
  const { donation } = SAMPLE_REPORT;
  const pickup = SAMPLE_REPORT.pickup;
  const title = donation.food_name ?? "Sample donation";
  const portions = donation.portions ?? 0;
  const category = donation.category ?? "";

  const crumbs: Crumb[] = [
    { label: "My donations", href: "/donor/donations" },
    {
      label: [
        shortCode(SAMPLE_ID),
        `${portions} ${portions === 1 ? "portion" : "portions"}`,
        category,
      ]
        .filter((part) => part !== "")
        .join(" · "),
    },
  ];

  const windowText =
    pickup === null || pickup.pickup_start === null || pickup.pickup_end === null
      ? null
      : formatWindow(pickup.pickup_start, pickup.pickup_end, TIME_ZONE);

  return (
    <TrackingView
      title={title}
      crumbs={crumbs}
      statusLabel={statusLabel(donation.status)}
      statusTone={statusTone(donation.status)}
      journey={buildJourney(SAMPLE_REPORT, TIME_ZONE)}
      pickup={{
        windowText,
        address: ADDRESS,
        countdown: pickupCountdown(pickup?.pickup_end ?? null, NOW),
      }}
      volunteerLines={volunteerText(SAMPLE_REPORT.volunteer)}
      foodLines={foodSafetyLines(SAMPLE_REPORT, TIME_ZONE)}
      actions={trackingActions(donation.status)}
    />
  );
}
