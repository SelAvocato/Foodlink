import type { ReactNode } from "react";
import { PublicHeader } from "./public-header";
import { PublicFooter } from "./public-footer";

/** Public route map. Staff login was descoped Nov 19 - single shared /login. */
export const publicLinks = {
  howItWorks: "/#how-it-works",
  impact: "/#impact",
  about: "/about",
  safety: "/food-safety",
  login: "/login",
  donor: "/register/donor",
  volunteer: "/register/volunteer",
};

export function PublicPageShell({ children, showFooter = true }: { children: ReactNode; showFooter?: boolean }) {
  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader
        links={[
          { label: "How it works", href: publicLinks.howItWorks },
          { label: "Our impact", href: publicLinks.impact },
          { label: "About us", href: publicLinks.about },
          { label: "Food safety", href: publicLinks.safety },
        ]}
        loginHref={publicLinks.login}
      />
      <main className="mx-auto w-full max-w-[1280px] px-5 py-8 lg:px-8 lg:py-12">{children}</main>
      {showFooter ? (
        <PublicFooter
          notes={[
            "Contact information and organization location await confirmation.",
            "No personal beneficiary information is shown publicly.",
          ]}
          links={[
            { label: "About & contact", href: publicLinks.about },
            { label: "Food safety", href: publicLinks.safety },
            { label: "Login", href: publicLinks.login },
          ]}
        />
      ) : null}
    </div>
  );
}
