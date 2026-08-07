# Performance Validation — Phase 6

## What was actually verified

- **Static generation for nearly every new route**: the real production build output (`pnpm --filter @vercentlabs/landing build`) shows `/resources`, `/resources/glossary`, `/resources/erp-requirements-checklist`, `/compare`, and all SSG-generated dynamic-segment pages (`/resources/[slug]`, `/resources/glossary/[slug]`, `/compare/vercentlabs-vs-odoo`) as `○` (static) or `●` (SSG via `generateStaticParams`) — confirmed directly in the build's route table, not assumed. Only `/llms.txt` and `/resources/feed.xml` are `ƒ` (server-rendered on demand), which is correct and expected for request-time-generated machine-readable endpoints, not a regression.
- **Minimal client-side JavaScript surface**: exactly one new `"use client"` component this phase — `RequirementsChecklist`. Every other new component (`ArticleHeader`, `ContentFreshnessMeta`, `TableOfContents`, `KeyTakeaways`, `SourceList`, `InlineCitation`, `DefinitionBlock`, `DecisionMatrix`, `Callout`) is a Server Component, adding zero client JS.
- **No new heavy dependencies**: nothing was added to `apps/landing/package.json` this phase — all new functionality (filtering, checkbox state, localStorage) is built on plain React `useState`/`useEffect`, no state-management library, no form library, no table library.
- **Real content, not lazy-loaded images, drives most new page weight**: resource guides and glossary pages are text-and-links; the only image-bearing new content is the comparison page (no new screenshots added — it reuses the same design tokens and layout primitives as the rest of the site, no new image assets).

## Not yet done (disclosed gap)

- **No Lighthouse or Core Web Vitals measurement** was run against any new route this phase — static generation and minimal client JS are structurally good signs, but no actual LCP/CLS/INP numbers were captured.
- **No bundle-size diff** was measured before/after this phase's changes — reasonable to expect a small increase (9 new Server Components + 1 small Client Component), but not quantified.
- **No production CDN/caching-header validation** — this repo's actual deployment/caching configuration wasn't exercised as part of this phase's local production-build validation.

These gaps are explicitly named as Phase 7 scope (see `phase-7-brief.md`'s Core Web Vitals / JS reduction / image performance items) — Phase 6's own definition of done is "don't prematurely do Phase 7's optimization work," so this is a deliberate, not accidental, gap.
