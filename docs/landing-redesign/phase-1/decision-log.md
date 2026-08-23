> Vercentlabs Landing Redesign — Phase 1, Quality Debate + Decision Log
> Every decision below records: Decision, Evidence, Alternatives considered, Reason selected, Risks, Mitigation.

## 1. Restore vs. rebuild `apps/landing`

**Decision:** Do not restore. Build from scratch in later phases.
**Evidence:** `apps/landing` was found staged for deletion (uncommitted, 78 files) with no recoverable rationale in git history, reflog, or branches. Presented to the user directly with both options before any further work.
**Alternatives considered:** (a) restore via `git restore --staged --worktree apps/landing` and audit the restored site; (b) pause for the user to investigate independently.
**Reason selected:** explicit user instruction.
**Risks:** the entire Workstream A per-route audit becomes inapplicable; some prior design-system/content work (referenced in this session's own memory index, e.g. an "os-*/operator-*" CSS system) is now unrecoverable from this repo state without the user separately sourcing it. Production deploy (`server.js` → `apps/landing/.next/standalone/...`) is currently broken until a new app exists (see [[current-experience-audit]]).
**Mitigation:** flagged the production-boot risk explicitly in the completion report and `phase-2-brief.md`; adapted every audit-dependent workstream to a target-architecture format instead of silently producing a thin/wrong audit.

## 2. Module taxonomy: 11 (brief) vs. 12 (repository)

**Decision:** Use 12 modules, treating Accounting as its own module distinct from Sales, per the actual repository taxonomy (`apps/web/src/app/(app)/accounting/**`, `services/api/src/modules/accounting/**`, 22 dedicated capability rows in the internal feature register).
**Evidence:** the governing brief's product-scope list names 11 modules without a standalone Accounting entry; the live codebase clearly implements Accounting as a full, independent module.
**Alternatives considered:** force-fit Accounting under Sales or under Shared Platform to match the brief's literal 11-item list.
**Reason selected:** the brief itself instructs "use the actual latest repository taxonomy... do not stop to debate whether the public website should say 11 or 12 modules" — this is a direct, unambiguous instruction favoring repository truth over the brief's own illustrative list.
**Risks:** none material — the brief pre-authorized this resolution.
**Mitigation:** documented explicitly in [[information-architecture]] so no future phase re-litigates it.

## 3. Feature-completeness register: evidentiary weight

**Decision:** `docs/VERCENTLABS_ERP_12_MODULE_FEATURE_REGISTER.md` is used only as a terminology/ID glossary, never as a signal of what is or isn't complete.
**Evidence:** the register is auto-generated static-evidence scanning that heavily cites the now-deleted `apps/landing` marketing pages as "evidence" a backend capability exists — circular, and in several cases the only cited evidence for a shared-platform claim was landing marketing copy, not application code.
**Alternatives considered:** treat "Not found"/"Partial" rows as real gaps and adjust marketing claims downward per module.
**Reason selected:** the governing brief explicitly and repeatedly instructs treating all 1,039 requirements as confirmed-implemented and forbids auditing completeness, asking for confirmation, or describing capabilities as hypothetical.
**Risks:** if the register's gaps are in fact real, some homepage/module copy could describe capability more confidently than end-to-end reality supports.
**Mitigation:** all marketing claims in this phase's docs are written to be traceable to concrete code evidence (real routes, real DB tables, real API modules) gathered independently by the Product Intelligence research, not to the register's pass/fail ratings — reducing (not eliminating) the risk while complying with the brief's instruction. Flagged as a residual risk in the completion report's "Remaining inputs."

## 4. Creative direction selection

**Decision:** Direction A — "Control Surface" (structured, blueprint-grade, real-screenshot-led, flat single-accent indigo, tight radii, near-flat elevation).
**Evidence:** scoring matrix in [[creative-direction]] — Direction A scored highest on product clarity, scalability, accessibility, performance, and implementation feasibility (8.3 average vs. 7.5 for Direction B "The Ledger" and 6.6 for Direction C "Live Operations"); grounded in the real product's light-mode workspace tokens (`globals.css`) rather than its dark gradient hero, which itself already borders on the brief's prohibited "generic blue-purple gradient" pattern.
**Alternatives considered:** Direction B (editorial/serif, highest distinctiveness/memorability) and Direction C (dark mission-control, most literal extension of the real product's sidebar/dashboard DNA and its per-module accent-color system).
**Reason selected:** ERP buying committees evaluate many pages, often on locked-down corporate hardware, sometimes via screen reader — Direction A wins the dimensions that matter most for that journey without sacrificing real distinctiveness (no named competitor uses a literal annotated-blueprint-grid identity).
**Risks:** lowest memorability/distinctiveness score of the three (6/10 vs. 8-9); could read as safe if executed without discipline.
**Mitigation:** Direction C's best idea (the real per-module accent-color system as a structural signal) is explicitly carried into Direction A's spec as a targeted device, preserving some of C's distinctiveness without its accessibility/performance cost.

## 5. Trust/social-proof section: omit vs. fabricate-adjacent placeholder

**Decision:** No dedicated "trust/social proof" homepage section at launch; trust is distributed across the Security and Cross-module Workflow sections instead.
**Evidence:** zero real customer logos, testimonials, review scores, or usage statistics exist to cite; the Evidence and Honesty Rules explicitly prohibit fabricating any of these.
**Alternatives considered:** (a) a generic "trusted by growing businesses" section with no logos (widely recognized by buyers as filler and actively erodes trust); (b) delay the homepage until real customer evidence exists (blocks the entire eight-stage programme on an external dependency outside this phase's control).
**Reason selected:** distributing real, honest evidence (security controls, provable workflow integration) does more credibility work than an empty or generic trust section, and doesn't block the programme.
**Risks:** the site currently has a genuine credibility gap relative to competitors who do show logos/testimonials.
**Mitigation:** flagged explicitly as a "Remaining input" in the completion report — real customer evidence should be added the moment it exists, without needing a design overhaul (the IA and blueprint don't structurally depend on its absence).

## 6. Conversion vs. SEO tension: workflow pages as both

**Decision:** `/workflows/*` pages are written primarily for AEO (answer-shaped, standalone-complete) but also carry the homepage's strongest cross-module conversion proof.
**Evidence:** [[category-and-competitor-research]] identifies workflow-as-narrative content as a category white-space opportunity; [[conversion-architecture]] identifies the "product evidence" and "trust and risk reduction" funnel stages as needing exactly this kind of concrete proof.
**Alternatives considered:** separate the concerns entirely — thin, conversion-focused workflow teasers on the homepage plus separate, deep, SEO-only workflow pages.
**Reason selected:** splitting the two would double the content-maintenance burden and risk the two versions drifting apart (a GEO/AEO consistency failure per [[seo-aeo-geo-architecture]]'s "consistent entities" principle); one well-built page can serve both if the direct-answer paragraph leads and the conversion narrative follows.
**Risks:** a page trying to serve two masters can serve neither well if not disciplined in execution.
**Mitigation:** the homepage-blueprint's cross-module workflow section links to, rather than duplicates, the full workflow page — the homepage gets a teaser, the workflow page gets the full AEO-structured content.

## 7. Visual ambition vs. performance/accessibility

**Decision:** Reject Direction C's dark, motion-permissive, glow-adjacent aesthetic in favor of Direction A's near-flat, high-contrast, motion-restrained approach.
**Evidence:** scoring matrix — Direction C scored lowest on accessibility (5/10, module accent colors like teal/slate on navy risk failing WCAG AA) and performance (5/10, multiple simultaneous live-feeling widgets).
**Alternatives considered:** adopt Direction C with heavy remediation (lightened on-dark color variants, motion budgets).
**Reason selected:** remediating C to an acceptable a11y/perf bar would essentially reconstruct much of A's discipline anyway, at higher implementation cost, for a marginal distinctiveness gain already partially recoverable (see Decision 4's mitigation).
**Risks:** none beyond what's already captured in Decision 4.
**Mitigation:** n/a — subsumed by Decision 4.

## 8. Feature depth vs. cognitive overload in navigation

**Decision:** Module mega-menu groups 12 modules into 5 buyer-facing categories (Revenue, Operations, Finance, People & Service, Delivery); no feature-level URLs for any of the 1,039 individual requirements.
**Evidence:** the brief explicitly warns against "exposing all 1,039 features in the main menu" and "organising content according to internal engineering structure"; [[category-and-competitor-research]] identifies SAP/older-Oracle-style dense feature-wall mega-menus as a pattern to reject.
**Alternatives considered:** a flat 12-item module list (simpler to build, but exactly the "wall of links" pattern the brief and research both flag); per-capability-group sub-pages under each module (would multiply page count well beyond what 3 ICPs and the current evidence base justify).
**Reason selected:** grouping by buyer mental model rather than internal module count reduces cognitive load while still surfacing all 12 modules within two clicks.
**Risks:** grouping choices are a judgment call and could be second-guessed once real user behavior data exists (Phase 7 CRO scope).
**Mitigation:** grouping is easy to adjust later since it's a navigation-config concern, not a URL-structure concern — no page has to move if the grouping changes.

## 9. Lead qualification vs. form friction

**Decision:** Single-step demo form (name, work email, company, phone required; segment/interest fields optional), no multi-step wizard.
**Evidence:** [[conversion-architecture]] — mid-market B2B buyers measurably abandon multi-step forms at a higher rate; qualification is deferred to sales follow-up rather than form gating.
**Alternatives considered:** a multi-step qualification wizard (company size → module interest → budget → contact info) common on some enterprise SaaS sites.
**Reason selected:** the primary conversion action is explicitly "Book a Demo," not "complete a qualification survey" — friction at this step directly opposes the stated core business objective.
**Risks:** sales may receive some lower-quality leads that a wizard would have filtered.
**Mitigation:** optional qualification fields (company size band, module of interest, current tools) still capture useful signal without gating submission; pre-fill from referring page context (e.g. arriving from `/modules/manufacturing`) recovers some qualification value for free.

## 10. Homepage section count: brief's ~19-item default vs. this blueprint's 12

**Decision:** 12 sections, per [[homepage-blueprint]]'s "sections removed" note.
**Evidence:** the brief's own instruction: "remove sections that do not earn their place."
**Alternatives considered:** implement all ~19 listed section types literally.
**Reason selected:** several listed sections (Product visual, Trust/proof, Automation, Reporting/Analytics, Objection handling) either duplicated another section's job in Direction A's design language or had no honest content to fill them at this evidence stage; forcing them in would pad the page and dilute the sections that do earn their place.
**Risks:** a reviewer expecting the brief's literal list might read the shorter blueprint as incomplete.
**Mitigation:** each omission is individually justified in [[homepage-blueprint]] with the specific reason, not silently dropped.
