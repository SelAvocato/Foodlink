import { DonorShell } from "./donor-shell";

export default function DonorLayout({ children }: { children: React.ReactNode }) {
  return <DonorShell>{children}</DonorShell>;
}
