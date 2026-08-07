# Phase 6 Brief — Content Authority, Resource Hub, Glossary, Comparisons

Per `CLAUDE.md`'s roadmap: "6. SEO, AEO, GEO, and content-authority system." Phase 5 shipped the full industry/solution/workflow/implementation tier (19 pages) this brief can now link into — every route named below can compose real module/industry/workflow content instead of describing it in the abstract.

## What Phase 5 leaves ready to compose with

- `/resources` is a reserved URL (Tier 5 in `docs/landing-redesign/phase-1/information-architecture.md`), not yet built — currently a footer/nav link with no real page behind it (a pre-existing gap, not introduced this phase; flagged honestly, not silently left).
- Every module, industry, solution, and workflow page now exists at a real, stable URL — resource-hub content should **link to** these for depth, never re-explain a capability inline (the same anti-cannibalisation discipline Phases 4-5 already established).
- `docs/landing-redesign/phase-1/product-intelligence.md`'s "Honest Limitations" section has real, specific, buyer-relevant facts that never made it into any FAQ across Phases 4-5 in full depth — a real, unused source of legitimate glossary/FAQ content, not something Phase 6 needs to re-research.
- The `BUYER_ROLES` registry (`packages/landing-content/src/buyer-roles.js`) and the `LANDING_ICPS`/`LANDING_INDUSTRIES` split reasoning (see Phase 5's `decision-log.md` item 2) are both directly reusable if Phase 6 wants role-specific or industry-specific resource content.

## Exact scope Phase 6 should evaluate (not a mandate — evaluate against real demand/evidence, same discipline as every prior phase)

1. **Resource hub (`/resources`)** — buyer FAQs, comparison tables, definitions, implementation guides, per the IA doc's Tier 5 description. This is explicitly the AEO/GEO content-authority surface, not a blog. Real quality threshold before ANY resource page ships: it must answer a real, specific query with real, cited evidence — the same "no fabricated stats, no invented capabilities" discipline as every module/industry/workflow page. **A hard requirement, not a suggestion:** no mass-generated thin pages. If a resource page cannot clear the same evidence bar as a module page, it should not exist, regardless of a keyword-volume argument for building it.
2. **Glossary** — term definitions (e.g. "What is 2-way matching?", "What is a numbering series?"). Real risk this phase should watch closely: a glossary is the single easiest content type to accidentally mass-generate into thin, near-duplicate pages. Recommend a hard cap (e.g. 20-30 real terms, each with a genuinely distinct, substantive definition tied to a real product mechanism) rather than an exhaustive terminology list, and a pre-build check that no glossary term's content is a rephrasing of an existing module/workflow page's direct definition.
3. **Comparison pages** ("Vercentlabs vs. X") — the highest-risk content type for fabrication. CLAUDE.md's Evidence and Honesty Rules explicitly forbid "fabricated comparisons." Any comparison page must be built only from verifiable, cited claims about Vercentlabs (this document's entire discipline already supports that) — it must NEVER claim to know a competitor's internal architecture, pricing, or unstated limitations without a real, citable public source. If that bar can't be cleared for a given competitor, don't build that comparison page. Recommend starting with zero comparison pages and only adding one when a specific, well-evidenced case exists — not a batch of them.
4. **`/about` and `/legal/*`** — Tier 4 P1 in the original IA, still unbuilt (a real, carried-forward gap from Phase 4 and Phase 5, not new). Lower priority than 1-3 but genuinely due; the footer has linked to `/about`, `/contact`, `/legal/privacy`, `/legal/terms` since Phase 2 with no real pages behind any of them.
5. **`/pricing`** — still explicitly out of scope until a phase with real pricing content is planned (per CLAUDE.md's existing instruction) — do not build a placeholder version in Phase 6 either.

## Explicit quality thresholds to prevent mass content generation (the core ask for whoever scopes Phase 6)

- Every resource/glossary/comparison page must trace every capability claim to `product-intelligence.md`, exactly like every page built in Phases 4-5 — no exceptions for "lower-tier" content.
- No page ships from a template with only the subject noun swapped — the differentiation bar Phase 4's `page-differentiation-matrix.md` and Phase 5's `search-intent-ownership.md` established (unique metadata + real content differentiation, not just unique URLs) applies here too.
- A hard cap on total new pages should be set *before* content generation starts, not discovered after — recommend Phase 6 open with the same kind of explicit route-count decision Phases 4-5 made (e.g. "the resource hub ships with N real articles this phase, not an open-ended list").
- Reuse the existing `BANNED_PHRASES` content-integrity test pattern (`packages/landing-content/tests/*.test.mjs`) for any new content file — this has caught real issues in every phase so far and should not be skipped for resource-hub content.

## What Phase 6 should NOT do

Final CRO/conversion optimization (that's Phase 7 — "CRO, analytics, performance, and accessibility optimisation" per CLAUDE.md), any `apps/web` ERP application changes (2 real, pre-existing bugs remain documented but unfixed — see Phase 5's `product-evidence-update.md` — still out of scope for the landing redesign), and `/pricing`.
