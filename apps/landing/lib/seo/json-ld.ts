import { SITE, absoluteUrl } from "../site.ts";

/**
 * JSON-LD builders. Every field here must trace to something real — no invented
 * ratings, review counts, or pricing (docs/landing-redesign/phase-1/
 * seo-aeo-geo-architecture.md, "GEO" section: "verifiable claims").
 */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.productName,
    url: SITE.url.toString(),
    logo: absoluteUrl("/icons/icon.svg"),
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.productName,
    url: SITE.url.toString(),
  };
}

export interface BreadcrumbEntry {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(entries: BreadcrumbEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: entries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: entry.name,
      item: absoluteUrl(entry.path),
    })),
  };
}

/** Renders a JSON-LD payload safely — never interpolate raw strings into a <script> tag. */
export function jsonLdScriptProps(data: unknown) {
  return {
    type: "application/ld+json" as const,
    // JSON.stringify already escapes control characters; replacing "<" prevents a
    // payload value from ever prematurely closing the script tag.
    dangerouslySetInnerHTML: { __html: JSON.stringify(data).replace(/</g, "\\u003c") },
  };
}
