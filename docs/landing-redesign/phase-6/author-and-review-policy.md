# Author and Review Policy

## Author model

One real, truthful organizational byline: **Vercentlabs Product Team** (`CONTENT_AUTHORS[0]` in `packages/landing-content/src/authors.js`). No invented individual experts, no fabricated credentials, no stock-photo headshot — `image`/`profileUrl` are left undefined rather than filled with placeholder content. This matches CLAUDE.md's own framing of the product as built by a real team, and the brief's explicit "do not invent experts" rule.

Every substantial resource (cornerstone guide, standalone glossary page, comparison) renders this byline via `ArticleHeader`/`ContentFreshnessMeta`, alongside real published/reviewed dates — never omitted for a page long/substantial enough to warrant one.

## Review dates: what "reviewed" actually means

`lastReviewedAt` in `CONTENT_FRESHNESS` means a human (in this phase, the implementing session, following the same standard a future editor would) actually read the page against current facts and confirmed it's still accurate — not a date bumped automatically by a build process or a copyright-year update. Every Phase 6 entry's `lastReviewedAt` is 2026-08-07, matching the real date this content was actually written and reviewed (not backdated, not projected forward).

## Never auto-bump review dates

`.claude/rules/landing-content.md` rule 5 is explicit: don't bump `lastModifiedAt` for a formatting-only or copyright-year change. This phase's `freshness.js` entries each carry a specific `reviewReason` describing what actually changed (e.g. "Phase 6: assigned the sales-quotation-detail screenshot..."), not a generic "Updated" placeholder — enforced by `freshness.test.mjs`'s `reviewReason.length > 15` check, which caught and forced a fix on one under-specified entry earlier this phase (see `decision-log.md` item 2's original fix history, carried from the summarized portion of this session).

## Review cadence by content type

See `freshness-and-sitemap-policy.md` for the full interval table (comparisons: 30 days, resource guides: 90, product/platform/industry/solution/workflow: 120, glossary: 180) and `check-stale-content.mjs` for the automated report that flags overdue routes.

## Who reviews what

This phase, the implementing session drafted, tested, and reviewed all content directly (no parallel human editorial team existed to divide the work with). Going forward, the `erp-editor` and `content-researcher` subagents (`.claude/agents/`) exist specifically to take over drafting/fact-gathering duties in a future session without collapsing the single-author-of-record model — their output is attributed to and reviewed by "Vercentlabs Product Team" as a whole, not to the subagent itself, consistent with `.claude/rules/landing-content.md` rule 9 (specialist agents report; the orchestrating session decides).
