import { SITE, absoluteUrl } from "../site.ts";
import { COMPANY_IDENTITY } from "@vercentlabs/landing-content";

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
    email: COMPANY_IDENTITY.primaryContactEmail,
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "sales",
        email: COMPANY_IDENTITY.salesContactEmail,
      },
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: COMPANY_IDENTITY.supportContactEmail,
      },
      {
        "@type": "ContactPoint",
        contactType: "security",
        email: COMPANY_IDENTITY.securityContactEmail,
      },
    ],
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

/**
 * The one, stable @id for the site-wide SoftwareApplication entity (declared
 * once, on the homepage — see app/page.tsx). Module pages reference this same
 * @id via `isPartOf: { "@id": SOFTWARE_APPLICATION_ID }` rather than
 * re-declaring a second, disconnected SoftwareApplication object — a Phase 4
 * Cycle 2 SEO review caught 12 module pages each declaring their own inline
 * `isPartOf` object with no @id, meaning no crawler could resolve them as the
 * same entity as the real one. See docs/landing-redesign/phase-4/decision-log.md.
 */
export const SOFTWARE_APPLICATION_ID = absoluteUrl("/#software");

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
