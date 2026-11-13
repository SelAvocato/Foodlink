export default function Home() {
  return (
    <main className="app-container flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center">
      <p className="text-xs font-medium leading-[18px] uppercase tracking-[0.2em] text-primary">
        FoodLink
      </p>
      <h1 className="text-3xl font-semibold leading-10 text-foreground">
        Care, coordinated.
      </h1>
      <p className="max-w-md text-sm font-normal leading-5 text-muted-foreground">
        A practical, accessible system for surplus food recovery.
      </p>
    </main>
  );
}
