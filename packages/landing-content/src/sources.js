/**
 * Editorial source registry — every external (non-Vercentlabs) factual claim
 * used in comparison or resource content must trace to a real entry here,
 * with a live-fetched sourceUrl and a real retrievedAt date (see
 * .claude/rules/landing-content.md rule 2 and
 * docs/landing-redesign/phase-6/source-and-citation-policy.md).
 *
 * Tiered by sourceType: "vendor" (a competitor's own official pages — the
 * primary source for that competitor's own facts), "standard"/"government"
 * (formal standards bodies), "industry-body"/"research" (associations,
 * research orgs), "documentation" (a vendor's own technical docs).
 *
 * These two entries were fetched live via WebFetch on 2026-08-07 against
 * odoo.com's real, current pages — not reconstructed from training data.
 * Pricing shown was geo-localized to INR at fetch time; comparisons.js
 * states this explicitly rather than silently presenting it as a global USD
 * figure.
 */
export const EDITORIAL_SOURCES = Object.freeze([
  {
    id: "odoo-pricing-2026-08",
    url: "https://www.odoo.com/pricing",
    title: "Odoo Pricing",
    publisher: "Odoo S.A.",
    retrievedAt: "2026-08-07",
    sourceType: "vendor",
    summary:
      "Odoo's own pricing page: a free One App plan, a Standard plan (all apps, Odoo Online only), and a Custom plan (all apps plus Odoo Studio, multi-company support, external API access, and on-premise/Odoo.sh deployment options). Prices displayed were geo-localized to INR at retrieval time.",
  },
  {
    id: "odoo-homepage-2026-08",
    url: "https://www.odoo.com/",
    title: "Odoo — Business Apps",
    publisher: "Odoo S.A.",
    retrievedAt: "2026-08-07",
    sourceType: "vendor",
    summary:
      "Odoo's own homepage: describes 8 primary application domains (Finance, Sales, Websites, Supply Chain, Human Resources, Marketing, Services, Productivity), a Community (open-source, free) vs. Enterprise (paid, extra apps/infrastructure/services) edition split, and self-hosted/Odoo.sh/cloud deployment flexibility with GitHub source access.",
  },
]);

export function getSource(id) {
  return EDITORIAL_SOURCES.find((source) => source.id === id) || null;
}
