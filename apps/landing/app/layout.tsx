import type { ReactNode } from "react";
import { ROOT_METADATA } from "@/lib/metadata";
import { organizationJsonLd, websiteJsonLd, jsonLdScriptProps } from "@/lib/seo/json-ld";
import { Header } from "@/components/navigation/header";
import { Footer } from "@/components/layout/footer";
import { AttributionInit } from "@/components/analytics/attribution-init";
import { StickyMobileCta } from "@/components/marketing/sticky-mobile-cta";
import "./globals.css";

export const metadata = ROOT_METADATA;

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f9fafb",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Header />
        <main id="main-content">{children}</main>
        <Footer />
        {/* Mobile-only spacer so the fixed sticky CTA bar never covers footer content. */}
        <div className="h-[calc(env(safe-area-inset-bottom)+5rem)] lg:hidden" aria-hidden="true" />
        <StickyMobileCta />
        <script {...jsonLdScriptProps(organizationJsonLd())} />
        <script {...jsonLdScriptProps(websiteJsonLd())} />
        <AttributionInit />
      </body>
    </html>
  );
}
