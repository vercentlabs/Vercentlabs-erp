# Phase 5 Decision Log

## 1. IA amendment: followed the governing prompt's literal route list over the approved Phase 1 IA doc

**Decision:** Built 4 industry pages (splitting distribution/retail) and 5 standalone `/solutions` pages, even though the approved `information-architecture.md` specifies only 3 industry pages (distribution-retail combined) and explicitly argues against a separate solutions tier ("a 'solution' in this product's case is either an industry framing or a workflow framing, not a third thing").
**Evidence:** `icp-and-buyer-map.md` independently reinforces the IA doc's position — it explicitly folds "replacing spreadsheets" and "consolidating disconnected systems" into the homepage's top-of-funnel framing rather than giving them dedicated pages, for the same anti-cannibalisation reasoning.
**Reason selected:** This is a real, structural conflict between two authoritative sources (the approved IA doc vs. the current, detailed governing prompt) that code-reading alone couldn't resolve — a decision only the user could make. Asked directly via a scoped clarifying question before any content was written; the user chose "Follow Prompt 5 literally," explicitly framing it as a deliberate IA amendment.
**Mitigation for the cannibalisation risk the IA doc warned about:** Every solution page names exactly one paired platform page as its differentiation anchor (`relatedPlatformPageSlug`) and goes materially deeper than the homepage's five-second pitch — a test (`solution-content.test.mjs`) asserts each solution's `problemStatement` is not textually identical to its paired page's `directDefinition`.
**Risks:** A future SEO audit could still find real overlap between a solution page and its paired platform page in practice, not just in the content model. Flagged in `search-intent-ownership.md` for monitoring, not treated as fully closed.

## 2. Distribution and retail split: one real ICP, two distinct pages — not two independently researched buyer segments

**Decision:** `/industries/distribution` and `/industries/retail` both set `icpSlug: "distribution-retail"`, referencing the same single Phase 1 buyer-research entry, rather than inventing a 4th ICP.
**Evidence:** `LANDING_ICPS` (`packages/landing-content/src/icps.js`) has exactly 3 entries, each the product of real Phase 1 research (company profile, pain points, buying committee, objections). No equivalent research exists for a split distribution vs. retail buyer.
**Alternatives considered:** Fabricate a 4th ICP with invented buyer-committee/trigger-event detail (rejected — a direct Evidence and Honesty Rules violation, inventing buyer research that wasn't done); merge the two into one page and ignore the prompt's explicit 4-industry route list (rejected — contradicts the user's approved decision in item 1).
**Reason selected:** Splitting at the *content presentation* layer (2 pages, distinct operating-model narrative, distinct module-stack emphasis, distinct screenshot) while keeping the *buyer research* layer honest (1 shared ICP) satisfies the route requirement without fabricating research.
**Risks:** None identified — `industry-content.test.mjs`'s "distribution and retail intentionally share one ICP" test codifies this as a checked, permanent design decision rather than an accident a future edit could silently break.

## 3. Deliberately skipped the two optional workflows (ticket-to-resolution, inspection-to-capa)

**Decision:** Built exactly the 6 required workflow pages; did not build the 2 explicitly-optional ones.
**Evidence:** The governing prompt named these as optional, contingent on evidence/time. `support-ticket-resolution` (existing, unrouted) is a close match for ticket-to-resolution; `physical-goods-quality-gate` is adjacent-but-narrower for inspection-to-capa — neither is a perfect fit without additional content work.
**Reason selected:** Given the phase's full scope (content architecture, 19 pages, conversion context, linking, 3 review cycles, 17 docs), the 6 required workflows plus real depth and full review-cycle time were judged higher-value than 2 more thin pages. Recorded as a deliberate scope decision, not a silent drop — both remain real, unrouted `LANDING_WORKFLOWS` entries any future phase can route directly.
**Risks:** None — no user-facing gap, since neither was promised as required.

## 4. Migration integrated into the Data Migration phase, not a separate `/implementation/migration` route

**Decision:** `/implementation` is one page; data migration gets the expanded `migrationChecklist` treatment inside its Data Migration phase rather than its own route.
**Evidence:** The approved IA doc lists no dedicated migration route under Tier 4. The governing prompt explicitly allowed either approach ("`/implementation/migration` or integrated").
**Alternatives considered:** A separate `/implementation/migration` page (rejected — would be a thin page mostly restating the same evidence already available in the Data Migration phase, and the IA doc doesn't call for it).
**Reason selected:** Integration avoids a thin, low-differentiation page while still giving migration real prominence (its own expanded checklist section, not a single bullet buried in a longer list).
**Risks:** If a future phase finds real migration-specific search demand ("ERP data migration checklist" as its own high-volume query), a dedicated page could be split out later without restructuring the phase's content — the `migrationChecklist` field is already isolated as its own data shape.

## 5. `HowTo` schema deliberately not used for workflow pages

**Decision:** All 6 workflow pages use `WebPage` + `FAQPage` + `BreadcrumbList`, the same pattern as every other page type — not `HowTo`, despite having the most step-by-step-shaped content on the site.
**Evidence:** `HowTo` is Google's schema for instructions a user manually follows (a recipe, an assembly guide). Workflow pages describe a cross-module business process the *software* executes for an organisation, not steps a reader performs themselves.
**Alternatives considered:** Using `HowTo` anyway for the potential rich-result visibility (rejected — this is schema misuse for a superficial gain, and Google's own guidance treats misapplied structured data as a spam signal risk, not a neutral no-op).
**Reason selected:** Matches the governing brief's own instruction to "evaluate against real content, don't force it." Documented explicitly so a future phase doesn't reintroduce it without re-litigating the same reasoning.
**Risks:** None identified — `FAQPage` still gives workflow pages real rich-result eligibility via their FAQ content.

## 6. Structural fix for the recurring analytics-event drift bug

**Decision:** Added `packages/landing-content/tests/analytics-events-sync.test.mjs`, which parses `index.d.ts`'s real source text to extract the declared `ANALYTICS_EVENTS` tuple and asserts an exact-set match against `navigation.js`'s runtime array.
**Evidence:** This exact bug — the `.d.ts` type declaring event names with no runtime backing — occurred independently in both Phase 3 and Phase 4, each time found only by a manual reviewer, with no test catching either occurrence.
**Alternatives considered:** A code comment reminding future editors to keep the two in sync (already existed in `navigation.js` before this phase — demonstrably insufficient, since it didn't prevent the Phase 4 recurrence); a build-time codegen step deriving one from the other (rejected as disproportionate — this repo has no existing codegen/build-step convention for its content packages, and introducing one for a single array is a bigger structural change than the bug warrants).
**Reason selected:** A regex-based source-text parse is a low-risk, dependency-free way to make the repository's own stated invariant ("these two must be kept in exact sync") into a real, enforced test rather than a comment, without introducing a new build step.
**Risks:** The regex assumes the tuple is written as a flat, `export const ANALYTICS_EVENTS: readonly [...]` block of string literals — a sufficiently unusual reformatting (e.g. splitting the type across multiple `type` aliases) could evade it. Judged acceptable: the current format is stable and the test's own assertion (`names.length > 0`) fails loudly if the parse comes back empty, rather than silently passing. **Update:** Cycle 2's frontend-quality review found and demonstrated a real, exploitable gap in the original single-quote-only regex (a single-quoted entry — valid TypeScript — parsed as zero matches, silently passing 82/82 tests with an untracked event). Fixed by broadening the regex to match both quote styles and adding an explicit assertion that rejects any single-quoted entry outright (surfacing the style inconsistency itself, not just tolerating it) — reproduced the reviewer's exact exploit against the fix to confirm it's now caught.

## 7. Conversion-context resolution priority on `/book-demo`

**Decision:** When more than one of `?module=`, `?industry=`, `?workflow=`, `?solution=` is present, resolution order is module → industry → workflow → solution (first match wins, both for module preselection and the contextual heading).
**Evidence:** No real page on the site ever links with more than one of these params simultaneously — this is a defensive ordering for a case that shouldn't occur in practice, not a designed multi-context experience.
**Reason selected:** Deterministic behavior matters more than which specific order is chosen, since the case is hypothetical; module-first matches the pre-existing Phase 4 behavior exactly (a `?module=` link's meaning doesn't change now that 3 more params exist).
**Risks:** None identified.

## 8. Workflow route selection deviates from this project's own `phase-5-brief.md` — deliberately, matching the governing prompt over an earlier self-authored planning doc

**Decision:** Shipped `order-to-fulfilment` and `hire-to-payroll` as 2 of the 6 routed workflows, rather than `quote-to-order` and `inventory-to-replenishment` — both of which `docs/landing-redesign/phase-4/phase-5-brief.md` (authored at the end of Phase 4, before this phase's actual governing prompt was issued) had named as the planned P0/P1 workflow routes.
**Evidence:** The governing prompt actually issued for this phase explicitly lists lead-to-cash, procure-to-pay, order-to-fulfilment, plan-to-produce, project-to-profitability, and hire-to-payroll as the required workflow set — a different, more specific list than the self-authored brief's earlier guess.
**Reason selected:** This is the same category of resolved conflict as item 1 (an earlier, self-authored planning artifact vs. the actual, current, more specific governing prompt) — the prompt is authoritative. `phase-5-brief.md` was itself explicit that its route list was a plan subject to revision, not a locked commitment: Phase 4's own decision-log documented the precedent of a later, more specific instruction superseding an earlier general one. `plan-to-production` (the existing `LANDING_WORKFLOWS` entry) was used to satisfy the prompt's "plan-to-produce" wording — the same real workflow, no separate entry needed.
**Risks:** `quote-to-order` and `inventory-to-replenishment` remain real, unrouted `LANDING_WORKFLOWS` entries — nothing was deleted, and either can be routed directly in a future phase if real demand argues for it. Not treated as a scope loss.
