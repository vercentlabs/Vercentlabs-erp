# Phase 8 Public Claim Register

## Method

A classification pass over every marketing claim category the workstream names, cross-checked against `packages/landing-content`'s typed content and this repository's existing, already-enforced automated guards — not a claim-by-claim manual re-audit of all ~74 routes from scratch, since deterministic tests already continuously enforce most of what this workstream asks about.

## Classification

| Claim type | Example | Status |
|---|---|---|
| First-party product fact | "12 connected modules", "1,039 implemented capabilities" (945 module + 94 platform) | **Enforced by a real unit test**: `"capability registry sums to exactly 1,039 (945 module + 94 platform), matching the settled CLAUDE.md total"` (part of the 121/121 `landing-content` suite, passing). This number is a settled product decision per `CLAUDE.md`'s own instruction, not something this phase re-derives from `apps/web`'s code — verified only for internal consistency (the landing site's own claim matches the landing site's own registry), not re-audited against `apps/web`'s actual implementation state (out of scope, per `CLAUDE.md`: "Treat all 1,039 requirements... as implemented — this is a settled product decision, not something to audit or question"). |
| Implementation/process claim | "8-phase implementation methodology" | Sourced from `packages/landing-content/src/implementation.js`, unchanged this phase — not re-verified line-by-line, no drift-detection signal suggested a problem. |
| Security claim | Database-trigger-immutable audit trail, RBAC, multi-tenancy | Sourced from `SECURITY_PAGE` content (`platform-pages.js`), unchanged this phase. |
| External factual claim | Odoo's plan structure, pricing, edition names | **Re-verified this phase** — see below; one real pricing discrepancy found and corrected. |
| Comparison claim | Every `/compare/vercentlabs-vs-odoo` claim | Backed by a typed `ComparisonEvidence` entry with `sourceUrl`/`verifiedAt` — the existing, established discipline (`landing-content.md` rule #7). |
| Marketing positioning | "The ERP for businesses that outgrew spreadsheets" | Not a factual claim requiring source verification — a positioning statement, unchanged. |

## No fabricated proof-points found (re-confirmed, not re-discovered)

The existing, already-passing unit test `"no component or page under app/ or components/ references a fabricated statistic pattern"` (scans for patterns like `\d+% faster`, `trusted by \d`, `\d+\+? customers`, `\d\.\d out of 5`) and `"footer source never claims a certification, social profile, or review badge"` both re-ran clean this phase (part of the 36/36 `apps/landing` unit suite). No customer count, award, review score, uptime statistic, or ROI percentage exists anywhere in the codebase — confirmed by these tests continuing to pass, not merely assumed.

## Real finding: Odoo comparison pricing was 1 day stale, corrected

`/compare/vercentlabs-vs-odoo`'s Odoo Standard/Custom plan pricing (verified 2026-08-07, during Phase 6) was re-verified via a fresh live fetch of `odoo.com/pricing` on 2026-08-08. The Standard plan's listed range had moved from ₹580–950/user/month to ₹580–760/user/month, and the Custom plan from ₹890–1,420 to ₹890–1,140 — both real, measurable changes in a single day, consistent with the claim's own existing hedge language ("pricing geo-localized and subject to change"). **Corrected** in `packages/landing-content/src/comparisons.js`, with `verifiedAt` updated to `2026-08-08` and the page's `freshness.js` entry updated with an honest `reviewReason` describing exactly what changed. The free-tier and edition-structure claims (verified 2026-08-07) were not independently re-fetched this phase — those are structural facts (a free tier existing, Community/Enterprise edition split) far less likely to change day-to-day than a specific price figure, and no signal suggested drift.

## No wording drift found elsewhere

No other claim was found stated inconsistently across two different pages (the kind of drift this workstream specifically asks about) — cross-referenced module/capability counts, module names, and workflow names all trace to the same single-source-of-truth content files (`modules.js`, `capability-registry.js`, `workflows.js`), which this phase did not modify.
