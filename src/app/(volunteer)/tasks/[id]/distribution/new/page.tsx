import { DistributionEntryScreen } from "@/features/volunteer/distribution/distribution-entry-screen";
import { VolunteerShell } from "../../../../volunteer/volunteer-shell";

export default async function DistributionNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <VolunteerShell>
      <DistributionEntryScreen donationId={id} mode="create" />
    </VolunteerShell>
  );
}