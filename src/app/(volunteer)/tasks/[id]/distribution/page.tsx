import { DistributionListScreen } from "./distribution-list-screen";
import { VolunteerShell } from "../../../volunteer/volunteer-shell";

export default async function DistributionListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <VolunteerShell>
      <DistributionListScreen donationId={id} />
    </VolunteerShell>
  );
}
