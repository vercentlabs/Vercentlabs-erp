# Phase 5 Brief — Industry, Solution, Workflow, and Implementation Pages

Per `CLAUDE.md`'s roadmap: "5. Industry, solution, workflow, and implementation pages." Phase 4 shipped the full module and platform layer this brief can now link into — every route named below can compose real module/platform content instead of describing it in the abstract.

## Source of truth

- `docs/landing-redesign/phase-1/information-architecture.md` — Tier 2 (3 industry pages), Tier 3 (6 workflow pages, P0/P1 only — the remaining flagship workflows in `product-intelligence.md`/`workflows.js` ship later, not invented here), Tier 4 (`/security` already shipped in Phase 4; `/implementation`, `/about`, `/legal/*` remain).
- `packages/landing-content/src/icps.js` — the 3 ICPs (`manufacturing`, `distribution-retail`, `professional-services`), each with a `primaryWorkflow` and `primaryModules` list already defined and ready to compose against.
- `packages/landing-content/src/workflows.js` — all 12 cross-module workflows with `iaPriority` already tagged; only P0 (`lead-to-cash`, `quote-to-order`, `procure-to-pay`) and P1 (`plan-to-production`, `inventory-to-replenishment`, `project-to-profitability`) get a page this phase, per the IA doc.
- `packages/landing-content/src/modules.js` (Phase 4) — every module's `businessProblems`, `capabilityGroups`, `primaryWorkflow`, and `connectedModules` are real, structured content industry/workflow pages should **compose and link to, not duplicate**. The IA doc's anti-cannibalisation rule is explicit: "Industry pages reuse module and workflow content via composition... rather than rewriting module claims per industry."

## Exact route list for Phase 5

```
/industries/manufacturing          (P0 — ICP 1: Manufacturing, Stock, Procurement, Quality, Accounting)
/industries/distribution-retail    (P0 — ICP 2: Stock, Point of Sale, Sales, Procurement, CRM)
/industries/professional-services  (P1 — ICP 3: Projects, CRM, Sales, Accounting, HR & Payroll)

/workflows/lead-to-cash             (P0 — CRM, Sales, Accounting)
/workflows/quote-to-order           (P0 — Sales, Accounting)
/workflows/procure-to-pay           (P0 — Procurement, Accounting)
/workflows/plan-to-production       (P1 — Manufacturing, Stock)
/workflows/inventory-to-replenishment (P1 — Stock, Procurement)
/workflows/project-to-profitability (P1 — Projects, Accounting, HR & Payroll)

/implementation                     (P0 — Tier 4, explicitly required by the conversion architecture's objection-handling stage)
```

`/about` and `/legal/*` are Tier 4 P1 — lower priority than the above; a reasonable Phase 5 stretch goal but not the core deliverable. `/pricing` and `/product-tour` remain out of scope until a phase with real pricing/video content is planned — do not build placeholder versions.

## What Phase 4 leaves ready to compose with

- Every module page now exists at a real, stable URL — industry and workflow pages should **link to** `/modules/{slug}` for depth, never re-explain a capability group inline.
- The homepage's flagship-workflow link (`/workflows/lead-to-cash`, 404 since Phase 3) finally resolves once this phase ships — no code change needed there, just the new page existing.
- `getWorkflowsForModule()` and `LANDING_WORKFLOWS` (already built, Phase 1) are ready to drive "which workflows touch this module" cross-links from both directions (module → workflow, workflow → module).
- The `PlatformHero`/`ModuleHero` pattern (4 controlled variants, evidence-aware fallback) is a proven, reusable template shape — industry/workflow pages will likely want their own 1-2 controlled variants rather than reinventing hero composition from scratch.
- `ContextualCta`, `LabeledItemGrid`, `Breadcrumbs` (now with the "Home" fix baked in), and the JSON-LD helpers (including the new `SOFTWARE_APPLICATION_ID` pattern) are all ready to reuse as-is.

## Known follow-ups to carry into Phase 5 (from this phase's own review cycles)

1. **Screenshot gap**: 9 of 12 modules still have zero dedicated screenshot evidence (`screenshot-extension-register.md`). A background capture attempt this phase stalled and failed. Retry with the checkpointed, one-module-at-a-time approach that register documents — Procurement, Manufacturing, Point of Sale, HR & Payroll first (P1/P2 priority), and a dedicated Accounting capture to replace its current empty state. Industry pages especially will want real screenshots (a manufacturing-industry page showing an empty Manufacturing module evidence section is a weaker page than one with real proof).
2. **FAQ depth**: every module currently has exactly 3 FAQs; `seo-aeo-geo-architecture.md` recommends 4-6. A dedicated content pass (this phase or a later one) has real, unused material to draw from — `product-intelligence.md`'s Honest Limitations section has more specific, buyer-relevant facts than currently made it into FAQ form.
3. **Meta description length**: several Phase 4 module pages run 160-198 characters, above the SERP-safe ~155-160 range — a tightening pass would help, not urgent.
4. **`ProductCallout` (in-image numbered annotations)**: built, demonstrated on `/design-system`, never applied to a real screenshot — a deliberate Phase 4 scope decision (`decision-log.md` item 10), worth picking up once more screenshots exist to annotate.
5. **`WorkflowConnector` mobile polish**: the horizontal-to-mobile fallback leaves a trailing line artifact instead of a clean connector between steps — minor, but this component will likely see even more use on workflow pages specifically, so worth fixing before it's the primary visual on 6 new pages.
6. **Per-page freshness signal**: `sitemap.ts` currently reuses one global `lastReviewed` date across all 22+ entries. A per-page (or per-content-file) `lastReviewed` field would give search engines and buyers a more honest freshness signal — worth introducing as part of whatever content model Phase 5 builds for industry/workflow pages, so it doesn't have to be retrofitted a third time.
7. **Header CTA analytics gap**: the header's primary "Book a Product Demo" button still uses a plain link, not the tracked variant, so its click-through is unmeasurable — pre-existing since Phase 2, low urgency, but worth a one-line fix whenever the header is next touched.

## Definition of done for Phase 5

- All 3 industry pages, 6 workflow pages, and `/implementation` built, real, evidence-grounded (traceable to `product-intelligence.md`, same discipline as Phase 4).
- Every industry/workflow page composes real module content via linking, never duplicates it.
- No new capability claim without a citation back to `product-intelligence.md`.
- Structured data extended consistently (industry pages likely want `WebPage`, workflow pages might reasonably use `HowTo` if the step-by-step content genuinely fits that schema — evaluate against real content, don't force it).
- Internal linking: module ↔ workflow ↔ industry forms a real, deliberate graph — no orphaned pages, no all-to-all linking.
- Three visual review cycles, same discipline as Phases 2-4 — a real build, a real boot, real screenshots, independent reviewer passes.
- Tests extended for the new route set (content integrity, route smoke tests, internal link resolution).
- Full validation suite green, work committed locally, nothing pushed.
