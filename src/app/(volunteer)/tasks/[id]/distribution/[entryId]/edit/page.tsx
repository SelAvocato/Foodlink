import { DistributionEntryScreen } from "@/features/volunteer/distribution/distribution-entry-screen";
import { VolunteerShell } from "../../../../../volunteer/volunteer-shell";

export default async function DistributionEditPage({
  params,
}: {
  params: Promise<{ id: string; entryId: string }>;
}) {
  const { id, entryId } = await params;
  return (
    <VolunteerShell>
      <DistributionEntryScreen donationId={id} entryId={entryId} mode="edit" />
    </VolunteerShell>
  );
}