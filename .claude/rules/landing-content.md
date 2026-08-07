---
description: Durable editorial rules for Vercentlabs landing/marketing content — evidence, sourcing, differentiation, freshness, terminology, comparison policy. Always apply when writing or editing landing-content copy.
paths:
  - "packages/landing-content/**"
  - "apps/landing/**"
  - "docs/landing-redesign/**"
---

# Landing content editorial rules

These rules govern anything under `packages/landing-content/**`, `apps/landing/**`, and `docs/landing-redesign/**`. They're durable — they don't change phase to phase. Phase-specific scope decisions live in each phase's `decision-log.md`, not here.

## 1. No fabricated evidence

Never invent customer names, logos, testimonials, user counts, revenue figures, market share, review scores, awards, certifications, uptime stats, performance improvements, ROI percentages, migration times, or support-response guarantees. If evidence doesn't exist yet, use real product screenshots, real workflows, or transparent methodology content instead. This is the single most important rule in this file — it overrides convenience, page-completeness pressure, and every other guideline below.

## 2. Primary-source preference

Any claim about a competitor, a standard, or an external fact must trace to a real, fetched, tiered source (see `docs/landing-redesign/phase-6/source-and-citation-policy.md` once written; until then, a `sources.js` `EditorialSource` entry with a real `sourceUrl` and `retrievedAt`). Tier 1 (government/standards bodies/vendor's own docs) and Tier 2 (industry associations/research orgs) sources are preferred over Tier 3 (secondary analysis). Never cite SEO blogs, content farms, or AI-aggregator sites as the sole source for a factual claim. If web access is unavailable when a claim needs external verification, leave that content in draft/noindex and document the gap — never substitute model memory for a live check on a fast-changing fact (competitor pricing, edition names, feature lists).

## 3. Differentiation, not duplication

Every page must own a distinct search intent (see `search-intent-ownership.md`). Before adding a new page, check whether its core question is already answered elsewhere. A new page must go materially deeper than any existing page's five-second pitch — restating another page's content in different words is not differentiation.

## 4. No keyword stuffing or thin content

Write for the buyer reading the page, not a ranking algorithm. No unnatural keyword density, no hidden text, no mass-generated near-duplicate pages, no location-page farming. Raw page count is never the goal — buyer usefulness and first-party originality are. A page that can't clear its type's quality bar (see the `content-authority-audit` Skill) stays in draft, gets merged into a stronger page, or doesn't ship.

## 5. Freshness must be real

Every `ContentFreshness` entry's `publishedAt`/`lastModifiedAt`/`lastReviewedAt` must be grounded in actual git history or an actual manual review, never invented or computed as `new Date()` at build time. `reviewReason` must state in plain language what the last significant change actually was — never a placeholder like "Updated." Don't bump `lastModifiedAt` for a formatting-only or copyright-year change.

## 6. Terminology must stay consistent

Use canonical module/workflow/entity names exactly as defined in `packages/landing-content/src/modules.js`/`workflows.js` and (once built) `entity-architecture.md`. Don't rephrase "Stock and Warehouse Management" as "Inventory Management" in running copy without also registering it as a documented alias — inconsistent naming is a real GEO/entity-recognition cost, not a stylistic nicety.

## 7. Comparison content must stay neutral and falsifiable

Never write "Vercentlabs is better than X." Frame both directions honestly: "X may be a stronger fit when..." and "Vercentlabs may be a stronger fit when...". Every factual claim about a competitor needs a typed `ComparisonEvidence` entry (`claimId`, `competitor`, `claim`, `sourceUrl`, `sourceTitle`, `verifiedAt`, `sourceType`) traceable to a real, current fetch — not a claim carried forward from a stale prior fetch without re-verification.

## 8. Citations and freshness apply per-resource, not just globally

Every substantial resource page (buying guide, glossary standalone entry, comparison, cornerstone guide) must expose its own author, published date, and last-reviewed date — not inherit the site's global freshness signal implicitly.

## 9. Specialist agents report; the orchestrating session decides

Content-research, fact-checking, and quality-audit subagents (`content-researcher`, `comparison-fact-checker`, `content-quality-auditor`, `internal-link-architect`, `erp-editor`) report structured findings — they do not have authority to fabricate facts, invent sources, or silently lower one of the rules above to make a page pass. Any finding that would require inventing evidence should be reported as "cannot verify — recommend draft/noindex," not resolved by writing something plausible-sounding instead.
