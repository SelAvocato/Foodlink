import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { roleHome } from "@/lib/role-home";
import { AuthSplitLayout } from "@/features/auth/auth-split-layout";
import { LoginForm, loginLinkClass } from "./login-form";

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
    <AuthSplitLayout
      heroTitle={["Welcome back to", "a shared purpose."]}
      heroNote={["Donors and volunteers use this portal.", "Your account must be approved before login."]}
      formTitle="Login to FoodLink"
      formSubtitle="Use your registered email and password."
    >
      <LoginForm
        footer={
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            New here?{" "}
            <Link href="/register/donor" className={loginLinkClass}>
              Register as donor
            </Link>
            <span aria-hidden>/</span>
            <Link href="/register/volunteer" className={loginLinkClass}>
              Volunteer
            </Link>
          </p>
        }
      />
    </AuthSplitLayout>
  );
}
