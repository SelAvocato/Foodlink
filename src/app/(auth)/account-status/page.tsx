import { StatusNoticeCard } from "@/features/auth/status-notice-card";
import { accountStatusCopy, parseAccountStatus } from "@/features/auth/account-status";

export const metadata = { title: "Application & account status - FoodLink" };

/**
 * p10. Next 16: searchParams is a Promise.
 * Only an allow-listed `status` value is read; anything else falls back to "invalid".
 * Free text (e.g. a rejection reason) is NEVER taken from the URL.
 */
export default async function AccountStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const status = parseAccountStatus((await searchParams).status);
  const c = accountStatusCopy[status];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-5 py-10">
      <div>
        <h1 className="text-[30px] font-semibold leading-10 text-foreground">Application & account status</h1>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Named reasons help users understand why access is unavailable.
        </p>
      </div>
      <StatusNoticeCard tone={c.tone} eyebrow={c.eyebrow} title={c.title}>
        {c.body}
      </StatusNoticeCard>
    </main>
  );
}
