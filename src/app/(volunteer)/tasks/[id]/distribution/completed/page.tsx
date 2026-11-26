import { CompletedDistributionScreen } from "./completed-distribution-screen";
import { VolunteerShell } from "../../../../volunteer/volunteer-shell";

export default async function CompletedDistributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <VolunteerShell>
      <CompletedDistributionScreen donationId={id} />
    </VolunteerShell>
  );
}
