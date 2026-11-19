import Link from "next/link";

const AREAS = [
  { href: "/admin/registrations", title: "Registration approvals", description: "Review and approve or reject pending donor and volunteer applications." },
  { href: "/admin/screenings", title: "Screening reviews", description: "Review the photo-screening queue and pass or reject cases." },
];

export default function StaffDashboardPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Staff dashboard</h1>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          Host organization workspace. More areas will appear here as they are built.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {AREAS.map((area) => (
          <li key={area.href}>
            <Link
              href={area.href}
              className="block h-full rounded-2xl bg-card p-6 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-base font-semibold text-foreground">{area.title}</span>
              <span className="mt-2 block text-sm leading-5 text-muted-foreground">{area.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
