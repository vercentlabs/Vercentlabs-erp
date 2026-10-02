import { SITE, absoluteUrl } from "../site.ts";
import { COMPANY_IDENTITY } from "@vercentlabs/landing-content";

/**
 * JSON-LD builders. Every field here must trace to something real — no invented
 * ratings, review counts, pricing, addresses, registration numbers, or social
 * profiles.
 *
 * Entity graph (stable @ids, one definition each):
 *   Organization  "Vercentlabs" (legalName "Vercentlabs LLP")   /#organization
 *     ├─ publisher of → WebSite                                 /#website
 *     └─ creator/publisher of → SoftwareApplication "Vercentlabs ERP"  /#software
 * Every other page refers to these by @id instead of re-declaring them.
 */
const ORGANIZATION_ID = absoluteUrl("/#organization");
const WEBSITE_ID = absoluteUrl("/#website");

/**
 * The one, stable @id for the site-wide SoftwareApplication entity (declared
 * once, on the homepage). Module and content pages reference it via
 * `isPartOf: { "@id": SOFTWARE_APPLICATION_ID }` rather than re-declaring it.
 */
export const SOFTWARE_APPLICATION_ID = absoluteUrl("/#software");

const organizationRef = { "@id": ORGANIZATION_ID } as const;

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    name: SITE.name,
    legalName: COMPANY_IDENTITY.legalName,
    description: `${SITE.name} makes ${SITE.productName}, ${SITE.category.toLowerCase().replace("erp", "ERP")}.`,
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
    "@id": WEBSITE_ID,
    name: SITE.name,
    url: SITE.url.toString(),
    publisher: organizationRef,
  };
}

/** Vercentlabs ERP — the product, made and published by the Vercentlabs organization. */
export function softwareApplicationJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_APPLICATION_ID,
    name: SITE.productName,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description,
    creator: organizationRef,
    publisher: organizationRef,
  };
}

/**
 * Author and publisher for editorial content. The byline (e.g. "Vercentlabs
 * Product Team") is a team within the Vercentlabs organization — never a
 * second, disconnected Organization entity.
 */
export function editorialAttributionJsonLd(authorName: string) {
  return {
    author: { "@type": "Organization", name: authorName, parentOrganization: organizationRef },
    publisher: organizationRef,
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
