import type { ReactNode } from "react";

import AnnouncementBar from "@/components/layout/announcement-bar";
import Header from "@/components/layout/header";

import MobileContactCta from "./mobile-contact-cta";
import SiteFooter from "./site-footer";

type MarketingShellProps = {
  children: ReactNode;
};

export default function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="os-site-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <AnnouncementBar />
      <Header />

      <main id="main-content" className="marketing-main">
        {children}
      </main>

      <SiteFooter />
      <MobileContactCta />
    </div>
  );
}
