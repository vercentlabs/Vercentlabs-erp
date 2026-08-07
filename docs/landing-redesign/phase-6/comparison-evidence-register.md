# Comparison Evidence Register

Human-readable mirror of `packages/landing-content/src/comparisons.js`'s `ODOO_COMPARISON_EVIDENCE` — every factual claim about Odoo used on `/compare/vercentlabs-vs-odoo`, with its live source. If this doc and the typed registry ever disagree, the typed registry is authoritative (this file is documentation, not a second source of truth) — regenerate this section from the code rather than editing the claim text here independently.

## Claims

| Claim ID | Claim | Source | Verified |
|---|---|---|---|
| `odoo-free-tier` | Odoo offers a free "One App Free" plan — one app, unlimited users, Odoo Online only. | [Odoo Pricing](https://www.odoo.com/pricing) | 2026-08-07 |
| `odoo-standard-plan` | Odoo's Standard plan (all apps, Odoo Online only) was listed at ₹580–950/user/month at retrieval, geo-localized and subject to change. | [Odoo Pricing](https://www.odoo.com/pricing) | 2026-08-07 |
| `odoo-custom-plan` | Odoo's Custom plan adds Odoo Studio, multi-company support, external API access, and Odoo.sh/on-premise deployment, listed at ₹890–1,420/user/month at retrieval. | [Odoo Pricing](https://www.odoo.com/pricing) | 2026-08-07 |
| `odoo-community-open-source` | Odoo Community is open-source and free with self-hosting and GitHub access; Enterprise adds extra apps/infrastructure/services. | [Odoo — Business Apps](https://www.odoo.com/) | 2026-08-07 |
| `odoo-app-breadth` | Odoo spans 8 domains and dozens of apps, including website building, e-commerce, and marketing automation. | [Odoo — Business Apps](https://www.odoo.com/) | 2026-08-07 |

## Methodology

Both sources were fetched live via `WebFetch` on 2026-08-07 — not reconstructed from model training data. `WebFetch`'s output was independently verified as reflecting real, current page content before this comparison was written (cross-checked plan names, prices, and app categories against the raw fetched text). Pricing on `odoo.com/pricing` was geo-localized to INR at fetch time; the comparison page states this explicitly rather than presenting it as a universal figure.

## What was deliberately NOT claimed

- **No Vercentlabs price point.** Vercentlabs has no published `/pricing` page or public per-seat price anywhere on this site. The comparison's pricing dimension states this gap honestly rather than inventing or estimating a number.
- **No manufacturing/quality depth comparison.** Odoo's own pages list Manufacturing, PLM, and Quality apps, but this phase did not independently verify their feature depth against Vercentlabs' own (documented, code-grounded) manufacturing/quality mechanics. The comparison's FAQ states this as an open, unverified question rather than assuming parity or superiority either way.
- **No audit-trail claim about Odoo.** No primary-source page was found describing a specific Odoo audit-trail immutability mechanism, so the "Audit trail and governance" dimension states plainly that this wasn't evaluated for Odoo's side, rather than guessing.

## Review cycle

Per `.claude/rules/landing-content.md` rule 7 and `freshness-and-sitemap-policy.md`, comparison content needs a shorter review cycle than glossary/evergreen content — competitor pricing and editions change. `/compare/vercentlabs-vs-odoo`'s `CONTENT_FRESHNESS` entry should be re-verified (live re-fetch of both sources) on a materially shorter interval than the site's other evergreen resources; see `freshness-and-sitemap-policy.md` for the specific interval recommendation.

## Adding a future comparison

Any new competitor comparison must repeat this exact process: live-fetch real primary sources for every claim, register each in `ODOO_COMPARISON_EVIDENCE`-equivalent typed evidence with a real `sourceUrl` and `verifiedAt`, and mirror the claims table here. If live web access is unavailable when a new comparison is requested, the comparison must stay in draft/noindex with the gap documented — never fabricated. See `.claude/agents/comparison-fact-checker.md` for the reusable verification workflow.
