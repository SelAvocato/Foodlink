import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { roleHome } from "@/lib/role-home";
import { AuthSplitLayout } from "@/features/auth/auth-split-layout";
import { LoginForm, loginLinkClass } from "../login/login-form";

export const metadata: Metadata = {
  title: "Staff login — FoodLink",
  description: "Sign in to the FoodLink host organization workspace.",
};

export default async function StaffLoginPage() {
  const session = await getServerSession(authOptions);
  if (session?.user) {
    redirect(roleHome(session.user.role));
  }
  return (
    <AuthSplitLayout
      heroTitle={["Coordinate care.", "Keep food moving."]}
      heroNote={["Secure workspace for the host organization.", "Public registration does not create staff accounts."]}
      formTitle="Staff login"
      formSubtitle="Organization staff only"
    >
      <LoginForm
        footer={
          <Link href="/login" className={loginLinkClass}>
            Return to donor / volunteer login
          </Link>
        }
      />
    </AuthSplitLayout>
  );
}
