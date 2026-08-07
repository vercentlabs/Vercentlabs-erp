# Solution Content Architecture

## Schema

`packages/landing-content/src/solutions.js` exports `LANDING_SOLUTIONS` (5 entries) matching `SolutionPage`: `slug`, `name`, `problemStatement`, `before`, `after`, `approach[]` (`{title, description, moduleKey?}`), `relatedPlatformPageSlug`, `relatedModuleKeys[]`, `relatedWorkflowSlugs[]`, `faqs[]`, `metaDescription`, `searchIntent`, `conversion{}`.

## Why this tier exists at all (the honest tension)

The approved Phase 1 IA doc (`information-architecture.md`) explicitly argued against a standalone `/solutions` tier: *"a 'solution' in this product's case is either an industry framing or a workflow framing, not a third thing."* `icp-and-buyer-map.md` went further, explicitly folding "replacing spreadsheets" and "consolidating disconnected systems" into the homepage's top-of-funnel framing rather than giving them dedicated pages, for the same anti-cannibalisation reasoning.

The governing prompt for this phase asked for 5 solution pages regardless. The user was asked directly (via a scoped clarifying question) whether to follow the IA doc or the prompt, and chose to follow the prompt literally, treating it as a deliberate IA amendment — see `decision-log.md` item 1.

## How each page earns its existence instead of duplicating the homepage or a platform page

Two safeguards, both enforced by tests (`solution-content.test.mjs`):

1. **One paired platform page, named explicitly** (`relatedPlatformPageSlug`) — every solution page links to exactly one platform capability page as its differentiation anchor, and a test asserts the solution's `problemStatement` is not textually identical to that page's `directDefinition`.
2. **Depth beyond the homepage's five-second pitch** — `replace-spreadsheets` and `connect-business-operations` specifically (the two concepts the IA doc explicitly said not to give a page) go materially deeper than `homepage.js`'s `PROBLEM_SECTION` (8 generic one-line bullets): each `approach[]` item cites a specific, real, code-evidenced mechanism (e.g. "a won opportunity is the source record for a quotation (`source_opportunity_id`)"), not a restatement of "departmental silos."

## The 5 pages and their differentiation anchor

| Solution | Problem framing | Paired platform page | Distinct from |
|---|---|---|---|
| Replace Spreadsheets | Item/BOM/pricing spreadsheets drifting out of sync | `/product` (overview) | The homepage's generic "duplicate data" bullet — this page names the actual replaced mechanism (master data, numbering series, audit trail) |
| Connect Business Operations | Departments working from disconnected tools | `/product/platform` | `multi-company-management` (below) — this is about cross-module data flow, not multi-entity isolation |
| Multi-Company Management | Running multiple legal entities/branches | `/product/platform` | `connect-business-operations` — this is about structural isolation and consolidation, not handoffs between departments |
| Workflow Automation | Manual approvals and re-entered recurring postings | `/product/automation` | The Automation platform page's own capability-first framing — this page is problem-first |
| Real-Time Business Reporting | Stale, disagreeing departmental numbers | `/product/analytics` | The Analytics platform page's registry-first framing — this page is problem-first |

## Evidence discipline

Every `approach[]` claim traces to `product-intelligence.md` — cross-module workflow citations (e.g. `source_opportunity_id`, 2/3/4-way matching), real automation capabilities (self-approval blocking across HR/Assets/Accounting/Projects), and real reporting registries (Accounting's 16 reports, CRM's 14, Procurement's 12). No new capability claims were authored for this phase.
