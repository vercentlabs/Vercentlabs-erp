# Comparison Policy

## Scope: 1 comparison, not several

Odoo only, this phase. Every candidate competitor (Zoho, NetSuite, Dynamics 365, SAP, Oracle, ERPNext) was considered and deliberately not built — each would require its own live research pass, its own evidence registry, and its own ongoing maintenance commitment. Odoo was chosen because it's the most publicly documented, most naturally adjacent competitor (open-source/SMB-tier positioning close to Vercentlabs' own market, with real, fetchable pricing and edition pages that don't require a sales call to access).

## The falsifiability rule

Never "Vercentlabs is better than X." Every dimension is framed as "X may be a stronger fit when..." and "Vercentlabs may be a stronger fit when..." — both directions, both real. Enforced by `comparison-content.test.mjs`'s explicit ban on absolute-superlative phrases (`vercentlabs is better`, `superior to`, `outperforms`, `the best erp`) and a requirement that both `strongerFitForOdoo` and `strongerFitForVercentlabs` have at least 2 real entries.

## Every claim needs typed evidence

`ComparisonEvidence { claimId, competitor, claim, sourceUrl, sourceTitle, verifiedAt, sourceType }` — no comparison claim about a competitor ships without one. See `source-and-citation-policy.md` and `comparison-evidence-register.md`.

## What to do when evidence doesn't exist

State the gap explicitly rather than guessing. Two real examples from this phase's page:
- The "Audit trail and governance" dimension states Odoo's own pages "do not detail a specific audit-trail immutability mechanism — not evaluated here since no primary-source claim was found to cite," rather than assuming parity or inferiority.
- An FAQ states the manufacturing/quality feature-depth comparison "was not independently verified... treat that specific depth comparison as unverified rather than assumed either way."

Cycle 2's `comparison-fact-checker` review independently confirmed both carve-outs are still accurate and that no other claim slipped through without a similar caveat.

## Review cadence

Comparisons get the shortest freshness-review interval of any content type on this site (30 days — see `freshness-and-sitemap-policy.md`), because competitor pricing, editions, and feature sets change faster than product-education or glossary content. `check-stale-content.mjs` flags any comparison route whose `lastReviewedAt` exceeds this.

## No cannibalizing alternate-page variants

One comparison gets exactly one URL (`/compare/vercentlabs-vs-odoo`) — no parallel `/alternatives/odoo` or `/best-odoo-alternative` page duplicating the same content under a different slug for extra keyword coverage. If a future phase finds real, distinct search intent for an "alternatives" framing, it would need its own genuinely different content (a multi-vendor roundup, not a Vercentlabs-vs-Odoo re-skin), not a copy.

## Mobile-safe table requirement

The comparison's `DecisionMatrix` component renders a real `<table>` on desktop (with horizontal scroll only if genuinely needed) and a stacked card layout below `sm` — verified via a real Playwright check that `document.documentElement.scrollWidth` equals `clientWidth` at 320px (no horizontal overflow), not assumed from the component's CSS alone. See `responsive-validation.md`.

## Adding a future comparison

Must repeat the exact same process: live-fetch real primary sources (never rely on model memory for fast-changing competitor facts — if web access is unavailable, the comparison stays in draft/noindex with the gap documented, per the brief's explicit Workstream X mandate), register typed evidence, frame both directions, pass the same test suite. See `.claude/agents/comparison-fact-checker.md` for the reusable verification workflow.
