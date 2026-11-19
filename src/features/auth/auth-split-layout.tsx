import type { ReactNode } from "react";

/**
 * p5 two-panel shell. Hero copy + form copy are props so the copy stays
 * with each caller. The form itself is passed as children.
 */
export function AuthSplitLayout({
  heroTitle,
  heroNote,
  formTitle,
  formSubtitle,
  children,
}: {
  heroTitle: string[];
  heroNote: string[];
  formTitle: string;
  formSubtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh gap-5 bg-background p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10 lg:p-10">
      <section className="flex flex-col rounded-2xl bg-primary p-8 text-primary-foreground lg:p-12">
        <p className="text-xl font-semibold leading-7">FoodLink</p>
        <div className="my-10 lg:my-auto">
          <h1 className="text-[30px] font-semibold leading-10 lg:text-[36px] lg:leading-[48px]">
            {heroTitle.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </h1>
          <p className="mt-6 text-sm leading-5 opacity-90">
            {heroNote.map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </p>
        </div>
        <p className="text-xs font-medium leading-[18px] opacity-90">Good food. Clear handovers. Accountable impact.</p>
      </section>

      <section className="flex items-center">
        <div className="w-full rounded-2xl bg-card p-8 lg:p-12">
          <h2 className="text-xl font-semibold leading-7 text-foreground lg:text-[30px] lg:leading-10">{formTitle}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{formSubtitle}</p>
          <div className="mt-8">{children}</div>
          <p className="mt-10 text-xs leading-[18px] text-muted-foreground">Approval required • Secure, role-based access</p>
        </div>
      </section>
    </main>
  );
}
