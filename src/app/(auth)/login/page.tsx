import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { roleHome } from "@/lib/role-home";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login — FoodLink",
  description: "Sign in to the FoodLink donor and volunteer portal.",
};

export default async function LoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(roleHome(session.user.role));
  }
  return (
    <main className="flex min-h-screen flex-col bg-background lg:grid lg:grid-cols-2">
      {/* Left panel: the portal's promise, in written words */}
      <section className="flex flex-col gap-10 bg-primary px-6 py-8 text-primary-foreground sm:px-10 lg:justify-between lg:px-16 lg:py-12">
        <p className="text-xs font-medium uppercase tracking-[0.2em]">FoodLink</p>
        <div className="max-w-md lg:max-w-lg">
          <h1 className="text-display font-semibold">Welcome back to a shared purpose.</h1>
          <p className="mt-5 text-base leading-6 text-primary-foreground/85">
            Donors and volunteers use this portal.
          </p>
          <p className="mt-1.5 text-base leading-6 text-primary-foreground/85">
            Your account must be approved before login.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-primary-foreground/20 pt-5 text-sm text-primary-foreground/80 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p>Approval required • Secure, role-based access</p>
          <p>Good food. Clear handovers. Accountable impact.</p>
        </div>
      </section>

      {/* Right panel: the form */}
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <div className="w-full max-w-md">
          <h2 className="text-heading font-semibold text-foreground">Login to FoodLink</h2>
          <p className="mt-1.5 text-body text-muted-foreground">
            Use your registered email and password.
          </p>

          <LoginForm />

          <hr className="my-6 border-border" />
          <p className="text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/register/donor" className="text-primary hover:underline">
              Register as donor
            </Link>
            {" / "}
            <Link href="/register/volunteer" className="text-primary hover:underline">
              Volunteer
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
