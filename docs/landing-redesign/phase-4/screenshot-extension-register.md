# Screenshot Extension Register — Phase 4

Extends `docs/landing-redesign/phase-3/product-evidence-register.md` and `screenshot-capture-process.md` — this document does not repeat their content, only what changed this phase.

## What this phase attempted

A background agent (isolated git worktree, targeting the same shared local Postgres + `apps/web` dev server as the main session) was dispatched to seed realistic records for the 9 modules with zero screenshot evidence (Accounting, Procurement, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll) in the existing synthetic "Vercent Demo Manufacturing" organization, and capture one representative screenshot per module, following the exact safety process established in Phase 3 (real app UI only, synthetic data only, never the real organization, never raw-SQL record creation).

**Result: the agent stalled after 600 seconds of no progress while investigating the `master-data/parties` route for a supplier/customer form, and was terminated without producing any usable screenshots.** No partial captures were recovered — the agent's isolated worktree was cleaned up automatically since no lasting file changes were made.

## Current state (unchanged from Phase 3, carried forward)

| Screenshot ID | Module(s) it evidences | Status |
|---|---|---|
| `crm-pipeline-board` | CRM (primary), also used as the homepage hero and `/product` overview hero | Approved |
| `crm-leads-list` | CRM (secondary) | Approved |
| `sales-quotation-detail` | Sales (primary) | Approved |
| `sales-order-detail` | Sales (secondary); also borrowed as Accounting's only screenshot | Approved |
| `stock-overview` | Stock (primary) | Approved |

9 of 12 modules — Procurement, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll, and Accounting (which only has a borrowed, non-dedicated reference) — ship this phase with no dedicated screenshot evidence. This is handled honestly, not hidden:
- `ProductEvidenceSection` (`apps/landing/components/modules/product-evidence-section.tsx`) renders nothing when neither `primary` nor `secondary` resolves to an approved screenshot — no placeholder, no broken image.
- `ModuleHero`'s `heroVariant` content was corrected this phase (see `decision-log.md`) so these 9 modules are honestly assigned `workflow-led`/`operational-sequence` layouts that don't need a screenshot, rather than a screenshot-based variant relying on a runtime fallback to paper over the gap.

## Why this wasn't retried this phase

The failed attempt consumed real wall-clock time investigating the real app's UI (a legitimate part of the task — seeding 9 different modules' worth of realistic data requires understanding 9 different real forms) without producing output. Given the scale of the rest of this phase's required work (32 pages, 3 review cycles, 16 documentation files) and that the system already handles the gap gracefully and honestly, retrying immediately was judged lower-value than completing and correctly documenting the rest of the phase. This is a real, acknowledged gap, not a silently dropped requirement — see `phase-5-brief.md` for the concrete retry plan.

## Retry plan (for whoever picks this up next, in this phase or Phase 5)

1. Seed one module's data and capture at a time, verifying each screenshot before moving to the next, rather than attempting all 9 in one long-running pass — this phase's failure mode (a single agent stalling mid-way through a long, unsupervised sequence) is best mitigated by shorter, checkpointed units of work.
2. Priority order, matching `information-architecture.md`'s P1/P2/P3 tiers: Procurement (P1) first, then Manufacturing, Point of Sale, HR & Payroll (P2), then Projects, Assets, Quality, Support (P3).
3. Accounting specifically needs a *dedicated* capture (a trial balance, GL, or AP/AR view) to replace its current borrowed `sales-order-detail` reference — check `apps/web/src/app/(app)/accounting/` for the most visually substantive real route.
4. Apply the same visual-quality bar Phase 3 established when a CRM opportunity-detail capture was rejected for exposing raw internal UUIDs unstyled — prefer views that read as polished product screens, not raw record-detail dumps.
