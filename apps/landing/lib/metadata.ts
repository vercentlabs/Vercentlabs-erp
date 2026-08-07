import type { Metadata } from "next";
import { SITE, absoluteUrl } from "./site.ts";

interface PageMetadataInput {
  title: string;
  description: string;
  path: string;
  /** Set false only for pages that must never be indexed (e.g. /design-system). */
  index?: boolean;
}

/**
 * Shared metadata builder — every indexable page must go through this, per
 * docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md's "metadata pattern"
 * (title + description + self-referencing canonical, defined once, not hand-written
 * per page).
 */
export function buildPageMetadata({ title, description, path, index = true }: PageMetadataInput): Metadata {
  const canonical = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical },
    robots: index
      ? { index: true, follow: true }
      : { index: false, follow: false, nocache: true },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: SITE.productName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export const ROOT_METADATA: Metadata = {
  metadataBase: SITE.url,
  title: {
    default: `${SITE.productName} — ${SITE.category}`,
    template: SITE.titleTemplate,
  },
  description:
    "Sales, inventory, procurement, production, and finance on one live system. Vercentlabs is the ERP for businesses that outgrew spreadsheets.",
  applicationName: SITE.productName,
  authors: [{ name: SITE.name }],
  generator: "Next.js",
  referrer: "strict-origin-when-cross-origin",
  keywords: ["ERP software", "manufacturing ERP", "inventory management software", "operational ERP"],
  // Real, discoverable feed — without this <link>, /resources/feed.xml was a
  // working but orphaned endpoint no crawler or feed reader could find (a
  // Cycle 2 seo-aeo-geo-reviewer finding).
  alternates: {
    types: { "application/rss+xml": absoluteUrl("/resources/feed.xml") },
  },
  openGraph: {
    type: "website",
    siteName: SITE.productName,
    title: `${SITE.productName} — ${SITE.category}`,
    description: "Sales, inventory, procurement, production, and finance on one live system.",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.productName} — ${SITE.category}`,
  },
  // app/icon.svg is auto-detected by Next.js's file-convention metadata API —
  // no manual `icons` entry needed here. See app/manifest.ts for PWA icon sizes.
};
