export default function DonorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b px-6 py-3 font-semibold">FoodLink · Donor</header>
      <div className="p-6">{children}</div>
    </div>
  );
}