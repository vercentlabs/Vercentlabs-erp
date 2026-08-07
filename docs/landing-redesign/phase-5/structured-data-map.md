# Structured Data Map — Phase 5

## Pattern (identical across all 19 new pages, matching Phase 4's proven approach)

- `WebPage` — every detail page (industry/solution/workflow/implementation), `isPartOf: { "@id": SOFTWARE_APPLICATION_ID }` referencing the single site-wide `SoftwareApplication` entity declared once on the homepage. Never a disconnected duplicate.
- `FAQPage` — every page with real FAQ content (all 19 do).
- `BreadcrumbList` — via the shared `Breadcrumbs` component, which always prepends "Home" structurally (the Phase 4 fix that makes this impossible to omit on a new page — verified still holds for all Phase 5 pages, since none of them bypass the shared component).
- `CollectionPage` with `hasPart` — the 3 new index pages (`/industries`, `/solutions`, `/workflows`), each listing its child pages as `WebPage` entries with real URLs, matching `/modules`'s existing pattern.

## `HowTo` — deliberately not used

Evaluated specifically for workflow pages (they have a real numbered sequence, the closest fit anywhere on the site). Rejected: `HowTo` schema is Google's markup for step-by-step instructions a user manually follows (a recipe, an assembly guide) — these pages describe a cross-module business process the *software* executes for an organisation. Using `HowTo` here would be reaching for a rich-result format that doesn't semantically match the content, which risks a manual action or just wasted markup more than it risks nothing. `WebPage` + `FAQPage` was judged the honest fit. See `decision-log.md` item 5.

## Verification

Every JSON-LD block was checked to render via `jsonLdScriptProps()` (the shared helper that escapes `<` to prevent premature script-tag closure) — no page constructs its own inline `<script>` tag by hand. Checked directly against the built site's HTML output during Cycle 1/2 review, not just source-code inspection.
