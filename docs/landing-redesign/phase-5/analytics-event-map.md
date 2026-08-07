# Analytics Event Map — Phase 5

## New events (added to both `packages/landing-content/src/index.d.ts`'s `ANALYTICS_EVENTS` type and `navigation.js`'s runtime array — kept in exact sync, now structurally enforced, see below)

| Event | Fired from |
|---|---|
| `industries_index_view` | `/industries` on scroll-into-view |
| `industry_page_view` | Each `/industries/{slug}` hero |
| `industry_final_cta_click` | Every CTA click on an industry page (hero, mid-page `ContextualCta`, final) — `ctaLocation` differentiates position, matching Phase 4's `platform_cta_click` reuse pattern |
| `solutions_index_view` | `/solutions` on scroll-into-view |
| `solution_page_view` | Each `/solutions/{slug}` hero |
| `solution_cta_click` | Every CTA click on a solution page |
| `workflows_index_view` | `/workflows` on scroll-into-view |
| `workflow_page_view` | Each `/workflows/{slug}` hero |
| `workflow_cta_click` | Every CTA click on a workflow page |
| `implementation_page_view` | `/implementation` on scroll-into-view |
| `implementation_cta_click` | Every CTA click on the implementation page |

`industry_page_view` already existed in the type (reserved, unused) since Phase 4 — this phase is the first to actually fire it.

## Structural fix for the recurring drift bug

Phase 3 and Phase 4 each independently hit the same bug: the `.d.ts` type tuple and the runtime array drifted apart with no test catching it, found only by a manual reviewer both times. This phase adds `packages/landing-content/tests/analytics-events-sync.test.mjs`, which parses `index.d.ts`'s real source text to extract the declared tuple and asserts it's an exact-set match against the real runtime array — drift is now a hard test failure, not a hoped-for manual sync. See `decision-log.md` item 6.

## Conversion-context properties

No new properties were added to `SafeAnalyticsProperties` (`apps/landing/lib/analytics.ts`) — the existing `industry`/`workflow` properties (already present, reserved since Phase 3/4) cover the new pages' needs; `module`/`section` cover the rest. No PII-shaped property was added, consistent with the type's existing allowlist discipline.
