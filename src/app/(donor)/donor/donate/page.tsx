import { parseDraftParam } from "./resume-logic";
import { DonateWizard } from "./donate-wizard";

export default async function DonatePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { draft } = await searchParams;
  // Static layer: the fixed donor label now lives in the wizard (donate-wizard.tsx).
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <DonateWizard hasDraftParam={draft !== undefined} initialDraftId={parseDraftParam(draft)} />
      </div>
    </main>
  );
}
