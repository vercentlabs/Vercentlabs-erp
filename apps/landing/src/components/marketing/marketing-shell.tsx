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
    <>
      <AnnouncementBar />
      <Header />

      <main id="main-content">{children}</main>

      <SiteFooter />
      <MobileContactCta />
    </>
  );
}
