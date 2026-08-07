# Structured Data Map — Phase 6

Every schema.org type used, matched to the routes that emit it, and why that type (not a different one) was chosen. All JSON-LD is built via `apps/landing/lib/seo/json-ld.ts`'s helpers (`jsonLdScriptProps`, `breadcrumbJsonLd` — the latter emitted automatically by the shared `Breadcrumbs` component on every route) plus inline objects per page, consistent with the pattern established in Phases 3-5.

## Type usage table

| Route(s) | Type(s) | Notes |
|---|---|---|
| `/resources` | `CollectionPage` | Lists the cornerstone guides + reference links |
| `/resources/[slug]` (5 prose guides) | `TechArticle`, `FAQPage` | `TechArticle` chosen over generic `Article` since these are technical/procedural buyer-education content, matching schema.org's own guidance; `datePublished`/`dateModified` sourced from `CONTENT_FRESHNESS`, never build time |
| `/resources/erp-requirements-checklist` | `TechArticle` | No `FAQPage` (its FAQs are a short static block, same TechArticle) |
| `/resources/glossary` | `CollectionPage` + `ItemList` | `ItemList` enumerates all 27 terms by name |
| `/resources/glossary/[slug]` (11 standalone) | `DefinedTerm`, `WebPage` | `DefinedTerm` is schema.org's purpose-built type for a glossary entry — `inDefinedTermSet` points back to `/resources/glossary`, the correct relationship |
| `/compare` | `CollectionPage` | |
| `/compare/vercentlabs-vs-odoo` | `TechArticle`, `FAQPage` | |
| Every route above | `BreadcrumbList` | Emitted automatically by the shared `Breadcrumbs` component |

## Author field

Every `TechArticle`'s `author` is `{ "@type": "Organization", name: "Vercentlabs Product Team" }` — an `Organization`, not a `Person`, since no individual author exists (see `author-and-review-policy.md`). This is schema-accurate: inventing a `Person` author would be a structured-data misrepresentation, not just a copy problem.

## What was deliberately NOT used

- **`HowTo`** — not used anywhere, including the requirements checklist and implementation checklist, for the same reason Phase 5's workflow pages avoided it: `HowTo` is for instructions a reader personally follows (a recipe, an assembly guide); an ERP evaluation checklist is a reference tool, not a step-by-step task a user completes and marks "done" on the page's own terms in the schema.org sense.
- **`Product`/`Offer`/`AggregateRating`/`Review`** — never used anywhere on the comparison page or any resource guide. No invented rating, review count, or price is ever represented in structured data, matching the same rule that governs visible copy (`.claude/rules/landing-content.md`).
- **`Comparison`/`Table`** — schema.org has no dedicated comparison-table type; the `DecisionMatrix` component's real `<table>` markup is left as plain semantic HTML rather than forcing an inapplicable type onto it.

## Validation

Every JSON-LD payload is built from the same real data (`CONTENT_FRESHNESS`, `CONTENT_AUTHORS`, the page's own content fields) that renders the visible page — there is no separate, hand-maintained structured-data object that could drift from what a reader actually sees. `jsonLdScriptProps()` escapes `<` characters to prevent premature script-tag closure, an existing, reused safety pattern from prior phases. Manual spot-check (not yet an automated schema validator in CI): fetched `/compare/vercentlabs-vs-odoo` and `/resources/glossary/rbac` in Cycle 1 and confirmed the JSON-LD blocks parse and their `dateModified`/`name`/`description` fields match the visible page content. A dedicated automated structured-data validator (e.g. asserting every JSON-LD block is valid JSON and its `@type` is a real schema.org type) is a reasonable Phase 7 addition, not yet built.
