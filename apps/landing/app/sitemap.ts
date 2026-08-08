import type { MetadataRoute } from "next";
import {
  LANDING_MODULES,
  PLATFORM_PAGES,
  LANDING_INDUSTRIES,
  LANDING_SOLUTIONS,
  ROUTED_WORKFLOW_SLUGS,
  RESOURCE_GUIDES,
  STANDALONE_GLOSSARY_SLUGS,
  VERCENTLABS_VS_ODOO,
  getFreshness,
} from "@vercentlabs/landing-content";
import { absoluteUrl } from "@/lib/site";

/**
 * Only routes that actually exist as pages belong here. The noindex
 * /design-system and /book-demo/thank-you routes are deliberately excluded
 * (see robots.ts and seo-aeo-geo-architecture.md's indexation rules).
 *
 * `lastModified` is read per-route from CONTENT_FRESHNESS
 * (packages/landing-content/src/freshness.js) — a real, deterministic date
 * grounded in this repository's git history, never `new Date()` at build
 * time. This replaced a single global date applied to every route uniformly,
 * a gap flagged in Phase 4's decision log, reflagged as still-deferred in
 * Phase 5's, and fixed here — see docs/landing-redesign/phase-6/decision-log.md.
 * `getFreshness()` throws on any route missing a real entry, so this file
 * cannot silently regress back to a placeholder date for a new route.
 */
function entry(path: string, changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"], priority: number): MetadataRoute.Sitemap[number] {
  return {
    url: absoluteUrl(path),
    lastModified: new Date(getFreshness(path).lastModifiedAt),
    changeFrequency,
    priority,
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    entry("/", "weekly", 1),
    entry("/book-demo", "monthly", 0.9),
    entry("/product", "monthly", 0.9),
    entry("/modules", "monthly", 0.9),
    ...LANDING_MODULES.map((moduleInfo) => entry(`/modules/${moduleInfo.key}`, "monthly", 0.8)),
    ...PLATFORM_PAGES.map((page) => entry(page.slug, "monthly", 0.7)),
    entry("/industries", "monthly", 0.9),
    ...LANDING_INDUSTRIES.map((industry) => entry(`/industries/${industry.slug}`, "monthly", 0.8)),
    entry("/solutions", "monthly", 0.8),
    ...LANDING_SOLUTIONS.map((solution) => entry(`/solutions/${solution.slug}`, "monthly", 0.7)),
    entry("/workflows", "monthly", 0.8),
    ...ROUTED_WORKFLOW_SLUGS.map((slug) => entry(`/workflows/${slug}`, "monthly", 0.7)),
    entry("/implementation", "monthly", 0.7),
    entry("/resources", "monthly", 0.8),
    ...RESOURCE_GUIDES.map((guide) => entry(`/resources/${guide.slug}`, "monthly", 0.7)),
    entry("/resources/glossary", "monthly", 0.7),
    ...STANDALONE_GLOSSARY_SLUGS.map((slug) => entry(`/resources/glossary/${slug}`, "monthly", 0.6)),
    entry("/compare", "monthly", 0.7),
    // "weekly" not "monthly" — comparisons carry a materially shorter real review
    // cycle than the rest of the site (competitor pricing/editions change faster
    // than product content), see freshness-and-sitemap-policy.md's 30-day interval
    // and comparison-evidence-register.md. A Cycle 2 SEO review found the sitemap
    // wasn't reflecting this distinct cadence — fixed here.
    entry(`/compare/${VERCENTLABS_VS_ODOO.slug}`, "weekly", 0.7),
    entry("/privacy", "yearly", 0.3),
    entry("/terms", "yearly", 0.3),
  ];
}
