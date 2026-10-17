import type { ReactNode } from "react";
import { ROOT_METADATA } from "@/lib/metadata";
import { organizationJsonLd, websiteJsonLd, jsonLdScriptProps } from "@/lib/seo/json-ld";
import { Header } from "@/components/navigation/header";
import { AnnouncementBanner } from "@/components/layout/announcement-banner";
import { Footer } from "@/components/layout/footer";
import { SkipLink } from "@/components/layout/skip-link";
import { AttributionInit } from "@/components/analytics/attribution-init";
import { WebVitalsReporter } from "@/components/analytics/web-vitals-reporter";
import { GoogleAnalyticsAdapter } from "@/components/analytics/google-analytics-adapter";
import { StickyMobileCta } from "@/components/marketing/sticky-mobile-cta";
import { RouteScrollManager } from "@/components/navigation/route-scroll-manager";
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
        {/* Belt-and-braces alongside Reveal's own fail-open branch (see
            components/motion/reveal.tsx): guarantees scroll-revealed content
            is visible for any client that never runs the bundle at all. */}
        <noscript>
          <style>{`[data-reveal],[data-reveal-item]{opacity:1 !important;transform:none !important}`}</style>
        </noscript>
        <SkipLink />
        <AnnouncementBanner />
        {/* Sentinel watched by Header's scroll-elevation IntersectionObserver
            (components/navigation/header.tsx) — an observer, not a raw scroll
            listener, matching the idiom already used by track-view.tsx. */}
        <div data-header-sentinel aria-hidden="true" className="h-px" />
        <Header />
        <RouteScrollManager />
        {/* tabIndex={-1}: without it, the skip link scrolls the viewport to
            #main-content but never moves keyboard focus there (an <a
            href="#fragment"> only focuses the target if it's natively
            focusable or has a tabindex) — a real WCAG 2.4.1 gap found in
            Phase 7 via a real keyboard test. Phase 8's cross-browser smoke
            suite then found WebKit doesn't reliably honor this native
            behavior either — see components/layout/skip-link.tsx and
            docs/landing-redesign/phase-8/decision-log.md. */}
        {/* No focus:outline-none here: the global :focus-visible base rule
            in globals.css already gives this element a visible ring when it
            receives programmatic focus from the skip link. A Tailwind
            focus:outline-none utility was previously used to suppress the
            mouse-click outline, but Tailwind's default variant order emits
            `focus:` after `focus-visible:` in the compiled CSS, so it would
            have won the cascade over an equal-specificity focus-visible
            utility too and re-hidden the skip-link's focus ring. */}
        <main id="main-content" tabIndex={-1}>
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
        <GoogleAnalyticsAdapter />
      </body>
    </html>
  );
}
