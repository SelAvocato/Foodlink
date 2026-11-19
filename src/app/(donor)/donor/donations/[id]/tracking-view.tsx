import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Breadcrumb, type Crumb } from "@/components/shared/breadcrumb";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Timeline, type TimelineStep } from "@/components/shared/timeline";
import type { Tone } from "@/components/shared/tones";

const ACTION_BUTTON = "w-[14.5rem] rounded-sm";
const UNAVAILABLE = "Not available yet";
// Figma p13 colours (read from the PNG); the tone tokens have no blue.
const ASSIGNED_BADGE = "rounded-sm! bg-[#edf2f6]! text-[#31425c]!";
const COUNTDOWN_CHIP = "rounded-sm! bg-[#fff4e0]! text-[#69460e]!";

/** The tracking screen with every value already formatted for display. */
export type TrackingViewProps = {
  title: string;
  crumbs: Crumb[];
  statusLabel: string;
  statusTone: Tone;
  journey: TimelineStep[];
  pickup: {
    windowText: string | null;
    address: string | null;
    countdown: string | null;
  };
  volunteerLines: string[];
  foodLines: string[];
  actions: { showQr: boolean; canCancel: boolean; cancelUnavailableNote: boolean };
  onShowQr?: () => void;
  onCancel?: () => void;
};

export function TrackingView(props: TrackingViewProps) {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
        <div className="flex flex-col gap-3">
          <PageHeader
            title={props.title}
            actions={
              <StatusBadge
                tone={props.statusTone}
                className={props.statusLabel === "Assigned" ? ASSIGNED_BADGE : undefined}
              >
                {props.statusLabel}
              </StatusBadge>
            }
          />
          <Breadcrumb items={props.crumbs} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_28rem] lg:items-start">
          <div className="flex flex-col gap-4">
            <SectionCard title="Donation journey" className="p-8!">
              <Timeline steps={props.journey} />
            </SectionCard>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {props.actions.showQr ? (
                  <Button
                    size="lg"
                    className={ACTION_BUTTON}
                    disabled={props.onShowQr === undefined}
                    title={props.onShowQr === undefined ? UNAVAILABLE : undefined}
                    onClick={props.onShowQr}
                  >
                    Show QR label
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="lg"
                  className={ACTION_BUTTON}
                  disabled
                  title={UNAVAILABLE}
                >
                  Message organization
                </Button>
                <Button
                  variant="link"
                  className="text-error-foreground"
                  disabled
                  title={UNAVAILABLE}
                >
                  Report an incident
                </Button>
                {props.actions.canCancel ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className={ACTION_BUTTON}
                    disabled={props.onCancel === undefined}
                    title={props.onCancel === undefined ? UNAVAILABLE : undefined}
                    onClick={props.onCancel}
                  >
                    Cancel donation
                  </Button>
                ) : null}
              </div>
              {props.actions.cancelUnavailableNote ? (
                <p className="text-sm text-muted-foreground">
                  Cancellation is unavailable after a volunteer is assigned.
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <SectionCard title="Pickup details" className="p-8!">
              {props.pickup.windowText !== null ? <p>{props.pickup.windowText}</p> : null}
              {props.pickup.address !== null ? <p>{props.pickup.address}</p> : null}
              {props.pickup.countdown !== null ? (
                <p className="mt-3">
                  <StatusBadge tone="warning" className={COUNTDOWN_CHIP}>
                    {props.pickup.countdown}
                  </StatusBadge>
                </p>
              ) : null}
              <h3 className="mt-4 text-base font-semibold text-foreground">Your volunteer</h3>
              {props.volunteerLines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </SectionCard>

            <SectionCard title="Food & safety" className="p-8!">
              {props.foodLines.map((line, index) => (
                <p key={index}>{line}</p>
              ))}
            </SectionCard>
          </div>
        </div>
      </div>
    </main>
  );
}
