# Phase 3 Decision Log

## 1. Operating model: single implementer, sequential reviewer subagents

**Decision:** Implemented the homepage and conversion journey directly, then dispatched the four review passes (UX/CRO, brand/design, SEO/AEO/GEO, frontend-quality) as sequential reviewer subagents against real artifacts (screenshots, then code) rather than parallel builder subagents.
**Evidence:** Same reasoning as Phase 2 decision-log.md item 1 — the homepage's 12 sections share one content model, one page file, and one design-token system; splitting the *build* across agents risks conflicting edits to the same small set of load-bearing files. The *review* step is naturally independent (each reviewer has a fixed lens and doesn't need to coordinate with the others mid-review), so that's where subagent dispatch actually paid off.
**Alternatives considered:** Parallel builder subagents per section; a single reviewer pass instead of four specialized ones.
**Reason selected:** Four independent, specialized review lenses against the same finished artifact catch different classes of defect (a UX reviewer and a brand reviewer independently and separately confirmed the same 320px header bug from different angles, which is stronger evidence than either alone).
**Risks:** Sequential reviewer dispatch is slower wall-clock than parallel; one background review agent hit a session-usage limit mid-run and had to be treated as a partial result rather than retried immediately.
**Mitigation:** Reviewer findings were cross-checked against real re-screenshots after fixes, not just trusted at face value — see `visual-review-log.md`.

## 2. Screenshot curation: excluded the opportunity-detail capture from marketing use

**Decision:** Of six screenshots the data-seeding process captured, only five are registered in `apps/landing/lib/product/screenshots.ts` with `approvedForMarketing: true`. The sixth — an opportunity detail page — was captured but deliberately not approved.
**Evidence:** That capture renders raw internal UUIDs across a dozen fields (company ID, branch ID, stage ID, lead ID, party ID, contact ID, owner user ID) with no styling treatment to hide them — it reads as an unfinished debug view, not a page a buying committee should see on a marketing site.
**Alternatives considered:** Crop or annotate the screenshot to hide the ID panels; re-capture a version of the page without exposing raw IDs; approve it as-is.
**Reason selected:** Cropping/annotating a screenshot after the fact risks looking edited/staged, which conflicts with the Evidence and Honesty Rules' spirit even though the underlying screenshot is real; simplest and most defensible is to only approve captures that are marketing-ready as captured.
**Risks:** One fewer real screenshot available for future opportunity-detail-specific content (e.g. a CRM module page).
**Mitigation:** Documented in `screenshot-capture-process.md` and flagged as a candidate for a cleaner re-capture in `phase-4-brief.md` — the opportunity-detail *page* itself is a real, working feature; only this particular capture is unsuitable for marketing use.

## 3. Demo form: reverted to the Phase 1 four-field required set, overriding this prompt's own field list

**Decision:** Only `firstName`, `email`, `phone`, `companyName`, and the consent checkbox are required on `/book-demo`. `jobTitle`, `industry`, `companySize`, and `primaryInterest` are optional.
**Evidence:** The initial implementation required 9 fields, following this prompt's own "recommended fields" list literally. `docs/landing-redesign/phase-1/conversion-architecture.md` — a more carefully evidence-grounded document from an earlier, dedicated conversion-strategy research phase — explicitly specifies a single-step form with only name/email/company/phone required, citing mid-market buyer form-abandonment behavior as the reason, and explicitly calling out company size and module interest as fields to leave optional.
**Alternatives considered:** Keep all 9 fields required, since this prompt listed them; make all fields but firstName/email optional (looser than Phase 1's spec).
**Reason selected:** This prompt's phrasing was "recommended fields," not a hard requirement — that word choice gives latitude to defer to the earlier, more rigorously justified decision instead of introducing a real conversion-rate regression. Treated as a genuine mistake to correct, not a deliberate scope call to preserve.
**Risks:** A reviewer expecting all 9 fields as literally listed might read this as non-compliance.
**Mitigation:** Documented here and confirmed independently by the UX/CRO reviewer's Cycle 2 finding, which flagged the 9-field version as a spec violation before this decision log was written — i.e., the fix was validated by an independent review pass, not just self-assessed.

## 4. Added FAQPage structured data for the buyer-questions section

**Decision:** `apps/landing/app/page.tsx` renders a `FAQPage` JSON-LD block sourced directly from `BUYER_QUESTIONS_SECTION.questions` (the same content already rendered visibly in the accordion — no separate/hidden copy).
**Evidence:** The SEO/AEO/GEO reviewer flagged this as a real gap: the homepage has a legitimate, real FAQ section (not manufactured for SEO — these are the actual "what buyers ask before booking a demo" questions from `product-intelligence.md`) with no matching structured data, which is exactly the kind of AEO signal `docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md` calls for.
**Alternatives considered:** Skip structured data for this section entirely (simpler, but leaves a real, low-risk AEO opportunity on the table); write separate FAQ copy just for the JSON-LD (rejected outright — would violate "no hidden content" and the Evidence and Honesty Rules).
**Reason selected:** The JSON-LD is generated directly from the same content array the visible accordion renders, so there is no possibility of drift between what's shown and what's marked up — zero incremental content-honesty risk for a real SEO/AEO benefit.
**Risks:** None identified; this is additive structured data over already-published, human-visible content.
**Mitigation:** N/A.

## 5. Did not add an industry/ICP self-identification section to the homepage

**Decision:** The homepage's role-based value section ("One system, every seat" — owners, sales, operations, finance, manufacturing, HR) was kept instead of adding a separate industry-card section (manufacturers / distributors / professional services), even though `docs/landing-redesign/phase-1/homepage-blueprint.md` (an earlier planning document) sketches an industry-identification block.
**Evidence:** This prompt's own explicit section list for the homepage specifies role-based value, not industry cards. `docs/landing-redesign/phase-1/creative-direction.md` and the brief's own "no excessive card grids" instruction both push against adding another card-grid pattern purely to restate audience segmentation that the hero's eyebrow ("Connected ERP for manufacturers and distributors") and meta description already state plainly.
**Alternatives considered:** Add a third, separate industry-identification section between Module Architecture and Breadth.
**Reason selected:** This prompt's instructions are the more specific and more recent authority for this exact deliverable (the homepage section list), and superseding an earlier, higher-level blueprint with a later, more specific brief is the correct precedence rule when the two genuinely conflict, per general instruction-following practice. Industry-specific pages remain the correct home for deep ICP-specific content (Phase 5).
**Risks:** A buyer who identifies primarily by industry rather than by role might scroll past the hero's naming without a second, more detailed reinforcement.
**Mitigation:** Flagged as a real, deliberate scope reconciliation (not an oversight) here and in `phase-4-brief.md`, where Phase 5's industry pages are the intended home for this content.

## 6. Fixed the analytics event type contract instead of leaving it as discovered

**Decision:** `ANALYTICS_EVENTS` (in `packages/landing-content`) and every `analyticsId` field on homepage content are now literal TypeScript types, not `string`/`string[]`. `apps/landing/lib/analytics.ts`'s `AnalyticsEventName` union now genuinely rejects an unrecognized event name at compile time — confirmed by a scratch file that fails `tsc` with a misspelled event name.
**Evidence:** Discovered while writing this documentation set's `analytics-event-map.md`: the previous `.d.ts` typed `ANALYTICS_EVENTS` as `readonly string[]`, which collapses `(typeof ANALYTICS_EVENTS)[number]` to plain `string` — meaning `AnalyticsEventName` was silently `string` all along, and every `track()` call site's apparent type safety was cosmetic.
**Alternatives considered:** Leave it and only flag it as a known gap for a later phase (lower risk of introducing a new typecheck failure right before commit).
**Reason selected:** This is a small, self-contained, and fully verified fix (typecheck, lint, and all 31+18 unit tests re-run green afterward; the fix itself was proven with a positive control) directly relevant to code being documented and committed in this same phase — deferring a known, easily-fixed correctness gap when already touching the exact files involved was not justified.
**Risks:** None identified post-fix; all validation re-ran clean.
**Mitigation:** N/A — see `analytics-event-map.md` for the corrected, authoritative event list.

## 7. Reverted a speculative `phone`/`mobile` fix after independent review disproved the diagnosis

**Decision:** `apps/landing/lib/crm-capture.ts` and `app/api/book-demo/route.ts` send only `phone` (as originally implemented) to the CRM capture endpoint — a same-session change that additionally sent `mobile` was reverted.
**Evidence:** An end-to-end test submission's database row showed an empty `mobile` column, misread as the phone number being silently dropped. The frontend-quality review pass checked that diagnosis against the real code: `services/api/src/crm.js`'s `leads` resource maps `phone: "phone"` as its own real column (separate from `mobile`), and `tenant.crm_leads.normalized_phone` is a generated column (`COALESCE(mobile, phone)`) — so a `phone`-only submission was always correctly stored and correctly matched by phone-based deduplication. A direct, isolated HMAC-signed request to the real capture endpoint (bypassing the landing app entirely) with only `phone` set confirmed the column populated and normalized correctly, settling the question empirically, not just by re-reading code.
**Alternatives considered:** Keep sending both fields anyway, since it's harmless and mildly defensive.
**Reason selected:** The two columns are not simply redundant aliases — `mobile` is prioritized by `COALESCE(mobile, phone)` and is used elsewhere in the schema as the SMS/WhatsApp-consent-linked contact channel. This form collects one general phone number with no SMS/WhatsApp consent captured; labeling it `mobile` would assert a channel capability (SMS-reachability) the form never actually confirms. Sending it as the more general `phone` field is the semantically honest choice, and it was already correct.
**Risks:** None — this reverts a change to its original, verified-correct state.
**Mitigation:** N/A. Recorded here specifically as a caught misdiagnosis: worth keeping as a reminder that a single "it's empty in this one column" observation from a database query is not sufficient evidence for a root-cause claim — the same discipline this whole document tries to hold copy claims to (see `product-evidence-register.md`) applies equally to engineering diagnoses written into permanent docs.

## 8. Accepted an in-memory, single-process rate limiter as a known, documented limitation

**Decision:** `apps/landing/lib/rate-limit.ts` implements a minimal in-memory token-bucket rate limiter (5 requests / 15 minutes / IP on `/api/book-demo`) rather than a shared store (Redis, etc.).
**Evidence:** `apps/landing` has no shared-state infrastructure provisioned yet anywhere in the monorepo; adding one (and its associated ops burden — a Redis instance, connection config, failure-mode handling) is disproportionate to this phase's scope for a single low-traffic form endpoint.
**Alternatives considered:** A shared Redis-backed limiter; no rate limiting at all (rejected — the endpoint proxies to a real, billable CRM write, so unlimited submission volume is a real abuse surface).
**Reason selected:** In-memory, single-process limiting is a genuine first line of defense (blocks the most common abuse pattern — a script hammering the endpoint from one process/IP) without new infrastructure; the honeypot fields and the receiving CRM form's own `rate_limit_per_hour` provide additional, independent layers.
**Risks:** Limits reset on every deploy/restart and don't coordinate across multiple server instances if the app is ever horizontally scaled — a determined abuser distributing requests across instances or across restarts is not meaningfully rate-limited.
**Mitigation:** Documented directly in the source file's own comment (not just here) so a future engineer scaling this app horizontally sees the limitation at the point of use; a shared-store limiter is a reasonable addition once real traffic or abuse patterns justify the added infrastructure.

## 9. No runtime-validation library (zod, etc.) for the demo form

**Decision:** `apps/landing/lib/demo-form-validation.ts` is hand-written validation logic (regex + simple checks), not built on a schema-validation library.
**Evidence:** Neither `apps/landing` nor any other workspace package currently depends on zod or a similar library — introducing one for a single, small, flat-shaped form (13 fields, no nesting, no unions) would add a new dependency for less code than the hand-written version.
**Alternatives considered:** Add zod (or a lighter alternative) and define the form shape as a schema, matching `apps/web`'s `publicCaptureSchema` pattern (which does use zod, since that codebase already depends on it for many other endpoints).
**Reason selected:** `apps/web` has zod already because it validates dozens of complex, nested API request shapes across the whole product; `apps/landing` has exactly one form. Matching `apps/web`'s dependency for a single call site isn't justified until `apps/landing` accumulates more forms with genuinely complex shapes.
**Risks:** If `apps/landing` grows more forms in later phases, hand-written validation logic could be duplicated per-form instead of composed from a shared schema layer.
**Mitigation:** Revisit if a second non-trivial form is added in Phase 4+ — at that point the duplication cost likely justifies introducing a schema library.
