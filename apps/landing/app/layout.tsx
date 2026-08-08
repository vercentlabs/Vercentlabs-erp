import type { ReactNode } from "react";
import { ROOT_METADATA } from "@/lib/metadata";
import { organizationJsonLd, websiteJsonLd, jsonLdScriptProps } from "@/lib/seo/json-ld";
import { Header } from "@/components/navigation/header";
import { Footer } from "@/components/layout/footer";
import { AttributionInit } from "@/components/analytics/attribution-init";
import { WebVitalsReporter } from "@/components/analytics/web-vitals-reporter";
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
        {/* tabIndex={-1}: without it, the skip link scrolls the viewport to
            #main-content but never moves keyboard focus there (an <a
            href="#fragment"> only focuses the target if it's natively
            focusable or has a tabindex) — a real WCAG 2.4.1 gap found this
            phase via a real keyboard test, not assumed. See decision-log.md. */}
        <main id="main-content" tabIndex={-1} className="focus:outline-none">
          {children}
        </main>
        <Footer />
        {/* Mobile-only spacer so the fixed sticky CTA bar never covers footer content.
            Matches StickyMobileCta's own sm:hidden breakpoint exactly — see that
            component's doc comment for why this isn't lg:hidden. */}
        <div className="h-[calc(env(safe-area-inset-bottom)+5rem)] sm:hidden" aria-hidden="true" />
        <StickyMobileCta />
        <script {...jsonLdScriptProps(organizationJsonLd())} />
        <script {...jsonLdScriptProps(websiteJsonLd())} />
        <AttributionInit />
        <WebVitalsReporter />
      </body>
    </html>
  );
}
