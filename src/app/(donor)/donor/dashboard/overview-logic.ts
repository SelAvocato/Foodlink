import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import { pickupCountdown } from "@/app/(donor)/donor/donations/[id]/tracking-logic";
import { mapRow, type DonationListItemJson } from "../donations/donations-logic";

// A pickup is only worth a strip while it is close: at most one day away.
const STRIP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Only an upcoming pickup can end: drafts, finished and exited donations never do.
const STRIP_STATUSES: readonly string[] = [
  DonationStatus.POSTED,
  DonationStatus.ACCEPTED,
  DonationStatus.ASSIGNED,
];

/** "Good morning" (0 to 11), "Good afternoon" (12 to 17), "Good evening" (18 to 23); otherwise "Hello". */
export function greetingFor(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** The first word of the name, or null when there is no name to show. */
export function firstName(fullName: string | null | undefined): string | null {
  if (fullName === null || fullName === undefined) return null;
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first === "" ? null : first;
}

type Candidate = {
  item: DonationListItemJson;
  pickupEnd: string;
  end: number;
};

/**
 * One line about the next pickup within 24 hours: the soonest end among POSTED,
 * ACCEPTED and ASSIGNED items. null when no item qualifies.
 */
export function pickupStrip(items: DonationListItemJson[], now: Date): string | null {
  const current = now.getTime();
  if (Number.isNaN(current)) return null;

  let soonest: Candidate | null = null;
  for (const item of items) {
    if (!STRIP_STATUSES.includes(item.status)) continue;
    const pickupEnd = item.pickupEnd;
    if (pickupEnd === null) continue;
    const end = Date.parse(pickupEnd);
    if (Number.isNaN(end)) continue;
    // The window must still be open and start within the next day (exactly 24 hours counts).
    if (end <= current || end > current + STRIP_WINDOW_MS) continue;
    if (soonest === null || end < soonest.end) soonest = { item, pickupEnd, end };
  }
  if (soonest === null) return null;

  const countdown = pickupCountdown(soonest.pickupEnd, now);
  if (countdown === null) return null;

  // The same code text as the table row, so the strip and the row never disagree.
  const code = mapRow(soonest.item).code;
  const text = `Pickup ends in ${countdown.replace(/^Ends in /, "")} for ${code}.`;
  return soonest.item.status === DonationStatus.ASSIGNED
    ? `${text} Keep the food safely stored until the volunteer arrives.`
    : text;
}

const profileBodySchema = z.looseObject({
  profile: z.looseObject({ fullName: z.string() }),
});

/**
 * The donor's first name from a GET /api/donor/profile body. null for a failed or
 * unexpected shape, so the greeting simply shows without a name.
 */
export function profileFirstName(body: unknown): string | null {
  const parsed = profileBodySchema.safeParse(body);
  return parsed.success ? firstName(parsed.data.profile.fullName) : null;
}
