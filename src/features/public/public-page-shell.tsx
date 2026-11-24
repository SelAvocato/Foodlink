import type { ReactNode } from "react";
import { PublicHeader } from "./public-header";
import { PublicFooter } from "./public-footer";

export const publicLinks = {
  home: "/",
  howItWorks: "/how-it-works",
  about: "/about",
  safety: "/food-safety",
  login: "/login",
  donor: "/register/donor",
  volunteer: "/register/volunteer",
};

export function PublicPageShell({ children, showFooter = true }: { children: ReactNode; showFooter?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <PublicHeader
        links={[
          { label: "Home", href: publicLinks.home },
          { label: "How it works", href: publicLinks.howItWorks },
          { label: "About us", href: publicLinks.about },
          { label: "Food safety", href: publicLinks.safety },
        ]}
        loginHref={publicLinks.login}
        signUpHref="/#join"
      />
      <main id="top" className="flex-1">{children}</main>
      {showFooter ? (
        <PublicFooter
          notes={[
            "Contact information and organization location await confirmation.",
            "No personal beneficiary information is shown publicly.",
          ]}
          links={[
            { label: "Home", href: publicLinks.home },
            { label: "How it works", href: publicLinks.howItWorks },
            { label: "About & contact", href: publicLinks.about },
            { label: "Food safety", href: publicLinks.safety },
          ]}
        />
      ) : null}
    </div>
  );
}
