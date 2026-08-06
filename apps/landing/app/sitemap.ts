import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Only routes that actually exist as pages belong here. Phase 2 intentionally
 * ships only the temporary homepage (see docs/landing-redesign/phase-2/
 * implementation-summary.md) — module/industry/workflow pages are Phases 4-5.
 * The noindex /design-system route is deliberately excluded (see robots.ts and
 * seo-aeo-geo-architecture.md's indexation rules).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
