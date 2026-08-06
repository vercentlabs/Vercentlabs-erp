> Vercentlabs Landing Redesign — Phase 1, Workstream H
> Status: Decided. Supersede only via a new decision entry in `decision-log.md`.

## Starting condition

There is currently no deployed `apps/landing` (deleted, rebuilding from scratch per this session's decision) — meaning no live sitemap, robots file, metadata, or structured data exists in production for the marketing site today. This is a genuine foundation build, not a migration. That removes migration/redirect risk but means zero existing search equity to protect; the architecture below is written for a clean launch.

## SEO

**Core query families** (grounded in [[icp-and-buyer-map]] and [[information-architecture]]):
1. Category/branded — "vercentlabs", "vercentlabs erp"
2. Category-generic commercial — "ERP software", "ERP for [industry]", "[module] software"
3. Module-specific commercial — "manufacturing ERP", "inventory management software", "project accounting software", "procurement software"
4. Workflow/informational — "how does procure to pay work", "lead to cash process", "BOM to work order"
5. Comparison/evaluation — "[category] vs [alternative]", "best ERP for [industry]"
6. Trigger-event informational — "replace spreadsheets with ERP", "consolidate business software"

**Page ownership:** one page owns one query family member — enforced by the IA's anti-cannibalisation rules (module pages own module-commercial queries, workflow pages own workflow-informational queries, industry pages own industry-commercial queries, `/resources` owns comparison/evaluation and trigger-event informational content). No two pages target the same primary keyword.

**Metadata pattern:** every page defines a unique `<title>` following `{Primary Value Prop} | {Page Subject} | Vercentlabs` for module/industry/workflow pages and `{Page Subject} | Vercentlabs ERP` for utility pages; meta description states the page's core question-answered in one sentence plus the primary CTA. Implemented via a shared `generateMetadata` helper (Prompt 2 foundation) — never hand-written per page, to guarantee consistency and title-length compliance.

**Canonical strategy:** self-referencing canonical on every indexable page; `/product/security` canonicals to `/security` (see IA Tier 4 note) rather than existing as a true duplicate.

**Sitemap structure:** a single `sitemap.ts` generating all indexable routes with `lastModified` from content source data (not build time) so freshness signals are honest; legal/utility pages included with low priority; `/book-demo` and `/request-received` included but low-priority (they're conversion endpoints, not discovery targets).

**Indexation rules:** noindex `/request-received` (thank-you page — no value as a search result, and indexing it can leak conversion-confirmation content to non-converters via search); index everything else in the sitemap.

**Internal linking:** every module page links to its parent modules-group, its related workflows, and its related industries (see IA composition rule); every workflow page links back to every module it spans; every industry page links to its 3-5 most relevant modules and workflows. No orphan pages — everything in the sitemap is reachable within 3 clicks of the homepage per the IA's "avoid excessively deep navigation" rule.

**Breadcrumbs:** `Home / Modules / {Module}` and equivalent for industries/workflows, both visually rendered and marked up as `BreadcrumbList` structured data.

**Redirects:** none required at launch (no prior indexed content). A redirect map file is still established as a foundation pattern (empty at launch) so future URL changes have a governed home rather than ad hoc redirects.

**Media optimisation:** all product screenshots served via Next.js `Image` with explicit dimensions (prevents CLS), descriptive `alt` text stating what the screenshot shows (not decorative filler) — this doubles as an AEO signal (image context readable by crawlers) and an accessibility requirement.

**Programmatic-page limits:** none planned in Phase 1. The brief explicitly prohibits hundreds of near-identical location pages; this architecture has no location-based or auto-generated page type. If a future phase proposes one, it must justify unique content per page, not template substitution.

**International/localisation readiness:** the shared platform already implements localisation, currency, and timezone support (ERP-018 in the product register) as a product capability. The marketing site's IA reserves this as a Phase 5+ decision (a `/{locale}/` prefix strategy, if pursued) — not built now, but the metadata helper and route structure should not assume English-only in a way that blocks it later (a naming convention, not code, in Phase 1).

## AEO (Answer Engine Optimisation)

Every module, workflow, and industry page must be able to stand alone as a complete answer if only that page is quoted:
- **Direct answers:** the page's first paragraph after the H1 answers its core question in plain language before any marketing framing.
- **Definitions:** each module page defines its domain in one sentence a non-expert would understand (e.g. "Procurement is how a business turns a need into an approved purchase from a qualified supplier.").
- **Buyer FAQs:** 4-6 real questions per module/industry page (sourced from the objections in [[icp-and-buyer-map]] and [[positioning-and-messaging]], not invented filler), marked up as `FAQPage` structured data.
- **Comparison tables:** used only where a real, defensible comparison exists (e.g. "what's included in the Manufacturing module" as a capability-group table) — never a fabricated vs.-competitor table (prohibited by the Evidence and Honesty Rules).
- **Step-by-step workflows:** every `/workflows/*` page is structured as a literal numbered sequence (matches `HowTo` structured data intent) grounded in the real system sequence documented in [[product-intelligence]].
- **"Who it's for" explanations:** every module and industry page states explicitly who should and should not evaluate it (self-qualification reduces low-intent demo requests).
- **Implementation guidance:** `/implementation` answers "how long does this take and what does it require" directly and honestly.
- **Consistent entities:** module names, workflow names, and capability-group names are used identically everywhere (a single source-of-truth content model, see Phase 1 typed-content foundation) — inconsistent naming is the most common AEO self-sabotage.

## GEO (Generative Engine Optimisation)

- **Organisation identity:** `Organization` structured data on every page (via shared layout), consistent NAP-equivalent facts (company name, founding context, product category) stated identically site-wide.
- **Product identity:** `SoftwareApplication` structured data per module, with consistent `applicationCategory` and `featureList` drawn from the same typed content source used for on-page copy (no drift between structured data and visible text — a common GEO trust failure).
- **Consistent module entities:** the 12 module names and their one-sentence definitions are canonical across nav, module pages, workflow pages, and structured data — never renamed or reworded per context.
- **Original first-party knowledge:** workflow pages, the security architecture page, and the implementation methodology page are original explanatory content, not repackaged generic ERP advice — they describe how *this* system actually works.
- **Product screenshots and demonstrations:** real UI (per creative-direction's product-UI treatment), not illustration — generative engines and human buyers both trust concrete evidence over abstraction.
- **Verifiable claims:** every capability claim traces to a real feature (enforced by the typed product-content foundation being the single source both marketing copy and structured data draw from).
- **Update dates:** module/workflow pages carry a visible "last reviewed" date sourced from the content model, not hardcoded — supports both AEO freshness signals and internal content-maintenance discipline.
- **Author attribution:** guides in `/resources` (Phase 6 scope) carry a real author/role byline, not "Vercentlabs Team."
- **Internal knowledge relationships:** the module/workflow/industry cross-linking graph defined in the IA *is* the GEO entity-relationship signal — no separate knowledge-graph markup effort needed beyond consistent, honest internal linking.
- **Machine-readable structured data:** `Organization`, `WebSite`, `SoftwareApplication`, `BreadcrumbList`, `FAQPage`, `HowTo` — implemented via shared helpers in Prompt 2, populated from real content in Prompts 3-5.

**Explicitly rejected:** keyword stuffing, hidden content, mass-generated thin pages, fabricated FAQs, unsupported competitor comparisons, fabricated statistics/reviews, `llms.txt` as a substitute for the above (an `llms.txt` may still be added later as a *supplement* once real content exists — never as a shortcut around it), and location-page farming.

## Ownership of remaining SEO/AEO/GEO detail

Full query-by-query mapping, comparison-content planning, and the `/resources` content calendar are explicitly **Phase 6** scope ("SEO, AEO, GEO and content-authority system") per the eight-stage roadmap. This document establishes the architecture Phase 6 must follow, not the content itself.
