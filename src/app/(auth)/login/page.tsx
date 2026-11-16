import type { Metadata } from "next";
import Link from "next/link";
import { AuthSplitLayout } from "@/features/auth/auth-split-layout";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Login — FoodLink",
  description: "Sign in to the FoodLink donor and volunteer portal.",
};

export default function LoginPage() {
  return (
    <AuthSplitLayout
      heroTitle={["Welcome back to", "a shared purpose."]}
      heroNote={["Donors and volunteers use this portal.", "Your account must be approved before login."]}
      formTitle="Login to FoodLink"
      formSubtitle="Use your registered email and password."
    >
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
    </AuthSplitLayout>
  );
}
