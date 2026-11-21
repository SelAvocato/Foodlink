import { PickupInspectionView } from "./pickup-inspection-view";

export default async function PickupInspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PickupInspectionView key={id} donationId={id} />;
}
