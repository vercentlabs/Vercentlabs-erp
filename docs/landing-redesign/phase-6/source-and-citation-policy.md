# Source and Citation Policy

## Tiered source hierarchy

- **Tier 1** — government/standards bodies, and a competitor's own official pages (for facts about that competitor specifically). This is where `EDITORIAL_SOURCES`'s two current entries sit (`sourceType: "vendor"` — odoo.com's own pricing and homepage, the primary source for Odoo's own facts).
- **Tier 2** — industry associations, research organizations.
- **Tier 3** — secondary analysis, journalism about a vendor or category.

Tier 3 sources are never used as the *sole* citation for a factual, checkable claim (a price, a feature list, an edition name). SEO blogs, content farms, and AI-aggregator sites are never cited as primary evidence — if a fact can only be found on a Tier 3 source, treat it as unverified rather than laundering it through a citation.

## When a citation is required

- Any claim about a named competitor (pricing, features, editions, deployment model).
- Any external statistic or industry figure not already established in `product-intelligence.md`.
- NOT required for universal, uncontested terminology definitions (what is ERP, what is MRP) — these are standard-usage definitions, not competitor-specific or statistical claims. See `.claude/rules/landing-content.md` rule 2's scope note.
- NOT required for Vercentlabs' own product facts — those trace to `product-intelligence.md` or real code, a different (internal) evidence chain, not the external `EDITORIAL_SOURCES` registry.

## The `EditorialSource` shape

```
{ id, url, title, publisher, retrievedAt, sourceType, summary }
```

`retrievedAt` is the date the source was actually fetched/checked — not the date the source itself was published. Every `ODOO_COMPARISON_EVIDENCE` claim's `verifiedAt` should match or postdate its cited source's `retrievedAt`.

## How this phase's 2 sources were captured

Both `odoo.com/pricing` and `odoo.com` were fetched live via `WebFetch` on 2026-08-07, not reconstructed from training data. Cycle 2's `comparison-fact-checker` review independently re-fetched both — including downloading and grepping the raw HTML directly, not just trusting `WebFetch`'s summarization layer — and confirmed all 5 derived claims still matched. See `comparison-evidence-register.md` for the full claim-by-claim record.

## What happens when web access is unavailable

Per the brief's explicit Workstream X mandate: if live verification isn't possible for a claim that needs it, the content stays in draft/noindex and the gap is documented — never filled with a plausible-sounding but unverified statement. This didn't occur this phase (WebFetch was available and used), but the rule is binding for any future comparison or fact-dependent content.

## Citation rendering

The `SourceList` component (`apps/landing/components/content/source-list.tsx`) renders every source used on a page with its title (linked, tracked via `source_link_click`), publisher, tier label, and retrieval date — visible to the reader, not a hidden metadata-only citation. `InlineCitation` (`apps/landing/components/content/inline-citation.tsx`) exists for marking a specific claim inline but isn't currently used on any shipped page (the comparison page's claims are dense enough that a page-level `SourceList` was judged clearer than per-sentence inline markers) — available for a future page where inline attribution is clearer.
