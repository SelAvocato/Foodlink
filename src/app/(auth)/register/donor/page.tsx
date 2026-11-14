import { DonorRegistrationForm } from "./donor-registration-form";

export const metadata = { title: "Join as a donor · FoodLink" };

export default function DonorRegistrationPage() {
  return (
    <main className="min-h-screen bg-(--fl-canvas) text-(--fl-ink)">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <p className="text-xs font-semibold tracking-wide text-(--fl-primary)">
          FoodLink <span className="px-1">/</span> JOIN THE COMMUNITY
        </p>
        <h1 className="mt-10 text-3xl font-semibold tracking-tight sm:text-4xl">
          Join as a donor
        </h1>
        <p className="mt-3 text-[15px] text-(--fl-muted)">
          Submit your details for organization review. Login becomes available after approval.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_330px] lg:items-start">
          <DonorRegistrationForm />

          <aside className="rounded-xl bg-(--fl-success) p-6">
            <h2 className="text-xl font-semibold text-(--fl-primary)">What happens next?</h2>
            <ol className="mt-6 list-decimal space-y-4 pl-5 text-[15px] text-(--fl-muted)">
              <li>Staff review your proof.</li>
              <li>You receive an email decision.</li>
              <li>Once approved, log in to your workspace.</li>
            </ol>
          </aside>
        </div>
      </div>
    </main>
  );
}
