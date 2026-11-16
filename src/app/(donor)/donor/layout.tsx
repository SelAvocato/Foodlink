import { SignOutButton } from "@/features/auth/sign-out-button";

export default function DonorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b px-6 font-semibold">
        <span>FoodLink · Donor</span>
        <SignOutButton className="min-h-11" />
      </header>
      <div className="p-6">{children}</div>
    </div>
  );
}
