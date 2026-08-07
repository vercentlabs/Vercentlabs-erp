# Freshness and Sitemap Policy

## The model

`packages/landing-content/src/freshness.js`'s `CONTENT_FRESHNESS` — every indexable route (74 after Phase 6) has a real `{ publishedAt, lastModifiedAt, lastReviewedAt, reviewReason }` entry, grounded in actual git history (`git log --format=%ad -- <file>`) or an actual manual review, never `new Date()` at build time and never invented for visual variety. `getFreshness(path)` throws on any missing route, so a new page can't silently ship without a real entry — enforced by `freshness.test.mjs`.

This replaced a single global date (`HOMEPAGE_METADATA.lastReviewed`) that `sitemap.ts` previously applied to all 52+ routes uniformly — a gap flagged in Phase 4's decision log, reflagged as still-deferred in Phase 5's, and fixed in this phase (`decision-log.md` item 2).

## `reviewReason`: the real signal

Because this project's actual build history spans only a few real days (2026-08-05 through 2026-08-07), many `lastModifiedAt` dates cluster — that's genuinely when the work happened, not an artifact of lazy dating. `reviewReason` carries the real freshness signal even where dates repeat: every entry states in plain language what the last significant change actually was (e.g. "Fixed a mismatched screenshot... and added a real dedicated dashboard screenshot," not "Updated"). `freshness.test.mjs` enforces `reviewReason.length > 15` as a floor against placeholder text.

## Review intervals by content type

| Category | Interval | Why |
|---|---|---|
| Comparisons | 30 days | Competitor pricing/editions/features change fastest |
| Resource guides | 90 days | Buying/implementation advice ages moderately |
| Product/platform/industry/solution/workflow pages | 120 days | Tied to real product changes, which this project's velocity suggests aren't daily |
| Glossary | 180 days | Stable, evergreen definitions |

Enforced by `packages/landing-content/scripts/check-stale-content.mjs` (`pnpm content:stale`), which flags any route whose `lastReviewedAt` has exceeded its category's interval. This is a report only — it never edits `CONTENT_FRESHNESS` or bumps a date itself; a human reviews the flagged route and updates the entry with a real `reviewReason` once actually reviewed.

## Sitemap: stays single

`apps/landing/app/sitemap.ts` produces one `/sitemap.xml` covering all 74 indexable routes, each with a real per-route `lastModified` read from `getFreshness(path).lastModifiedAt`. At this scale (74 routes), segmenting into multiple sitemaps (e.g. by content type) would add real complexity for no real benefit — segmentation is only justified by genuine scale (typically tens of thousands of URLs) or a real crawl-budget problem, neither of which applies here. A single correct sitemap is preferable to unnecessary complexity, per the brief's own explicit guidance.

## `changeFrequency` and `priority`

`changeFrequency` is set per content type based on how often that type of page realistically changes (homepage "weekly," most content "monthly") — never a blanket "daily" that doesn't reflect reality. `priority` follows the site's real information-architecture tiering (homepage highest, glossary standalone pages lowest among indexable content) — not inflated uniformly.

## What's excluded from the sitemap

`/design-system` and `/book-demo/thank-you` (both `noindex`, per `robots.ts`) — unchanged from prior phases. No new noindex routes were introduced this phase; every Phase 6 route is real, complete, and genuinely meant to be indexed.
