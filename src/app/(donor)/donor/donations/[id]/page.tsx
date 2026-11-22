import { TrackingScreen } from "./tracking-screen";

/** Figma p13: one donation's tracking screen; the report is loaded in the client. */
export default async function DonationTrackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: params is a promise that must be awaited.
  const { id } = await params;
  return <TrackingScreen id={id} />;
}
