import type { MetadataRoute } from "next";
import { HOMEPAGE_METADATA, LANDING_MODULES, PLATFORM_PAGES } from "@vercentlabs/landing-content";
import { absoluteUrl } from "@/lib/site";

const lastModified = new Date(HOMEPAGE_METADATA.lastReviewed);

/**
 * Only routes that actually exist as pages belong here. Industry, solution,
 * and workflow pages are Phase 5 (docs/landing-redesign/phase-3/phase-4-brief.md).
 * The noindex /design-system and /book-demo/thank-you routes are deliberately
 * excluded (see robots.ts and seo-aeo-geo-architecture.md's indexation rules).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/book-demo"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/product"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/modules"),
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    ...LANDING_MODULES.map((moduleInfo) => ({
      url: absoluteUrl(`/modules/${moduleInfo.key}`),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...PLATFORM_PAGES.map((page) => ({
      url: absoluteUrl(page.slug),
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
