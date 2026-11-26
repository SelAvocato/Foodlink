import { CompleteDistributionScreen } from "./complete-distribution-screen";
import { VolunteerShell } from "../../../../volunteer/volunteer-shell";

export default async function CompleteDistributionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <VolunteerShell>
      <CompleteDistributionScreen donationId={id} />
    </VolunteerShell>
  );
}
