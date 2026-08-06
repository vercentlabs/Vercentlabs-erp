# Homepage Content Specification

Single source of truth: `packages/landing-content/src/homepage.js` (plain JS + hand-maintained types in `index.d.ts`, matching the package's existing convention). `apps/landing/app/page.tsx` renders exactly the sequence in `HOMEPAGE_SECTIONS` — nothing on the page is hardcoded outside that file except layout/structure.

## Section-by-section

| # | Section (`id`) | Purpose | Key content |
|---|---|---|---|
| 1 | `hero` | First-screen orientation + primary conversion | Eyebrow naming the audience ("manufacturers and distributors"), headline, sub-head, primary CTA (Book a Product Demo → `/book-demo`), secondary CTA (Explore the Platform → `/product/platform`), 4 evidence metrics (12 modules / 1,039 capabilities / multi-company / role-based), real screenshot (`crm-pipeline-board`) |
| 2 | `problem` | Establish the cost of disconnected tools before pitching the solution | 8 pain points: duplicate data, manual reconciliation, delayed approvals, inventory uncertainty, inconsistent reporting, weak process ownership, departmental silos, limited auditability |
| 3 | `connected-system` | Explain *why this is an ERP, not five apps with one login* | 8-step pipeline diagram (Lead → Opportunity → Quotation → Sales order → Warehouse & production → Quality → Invoice → Support), each step tagged to its owning module with the real module accent color |
| 4 | `modules` | Show full breadth without a card-grid feature dump | 5 nav groups (Revenue, Operations, Finance, People & Service, Delivery) as full-width "information band" rows, each listing its modules as color-tagged links to `/modules/{key}` |
| 5 | `breadth` | Justify the "1,039 capabilities" claim with a real breakdown | 945 operational + 94 shared platform, plus "governed automation" and "immutable audit trail" as qualitative breakdown items |
| 6 | `flagship-workflow` | Prove the connected-system claim with one concrete, followable workflow | 6-step "lead to cash" sequence (lead captured → opportunity → quotation → customer accepts → order confirmed → invoice posted), each step showing department + real system behavior; paired with 3 real screenshots (`crm-pipeline-board`, `sales-quotation-detail`, `sales-order-detail`) |
| 7 | `role-value` | Translate the same connected data into per-role value | 6 roles: owners & executives, sales teams, operations teams, finance teams, manufacturing teams, HR & people teams |
| 8 | `automation` | Show automation is structural, not a bolted-on feature | Approval routing, separation of duties, SLA/escalation, quality holds, cross-module reporting |
| 9 | `security` | Answer the buying-committee security questions directly | Role-based access, time-bound & scoped roles, approval workflows, immutable audit trail, multi-company isolation, tenant isolation |
| 10 | `implementation` | Set honest expectations about rollout, not just the product | 7-step rollout (discovery → configuration → data migration → validation → team training → controlled launch → post-launch support); paired with a "Talk to an ERP Specialist" CTA |
| 11 | `buyer-questions` | Direct-answer FAQ, also serves as `FAQPage` structured data | 6 real buyer questions (multi-company support, module adoption model, workflow configurability, data migration, industry fit, access control) |
| 12 | `final-cta` | Closing conversion moment | Single primary CTA (Book a Product Demo → `/book-demo`) |

## Cross-cutting rules enforced by content tests

`packages/landing-content/tests/landing-content.test.mjs` (18 tests) enforces, at content-authoring time rather than relying on manual review:
- Exactly 12 sections, each with a unique `id`, a non-empty `heading`, and an `analyticsId`.
- Every CTA points at an approved destination (no `#`/placeholder hrefs) and uses the correct, non-generic label.
- Every module key referenced (module architecture section, flagship-workflow module tags) resolves to a real entry in `LANDING_MODULES`.
- The flagship workflow's `workflowSlug` resolves to a real workflow in the shared workflow catalog.
- Module-architecture group summaries match the real nav-group structure exactly (no orphaned or missing groups).
- No section copy contains a banned overclaiming phrase (fabricated stats, superlatives without evidence) — see `homepage-copy-rationale.md`.

## Conditional layout, not hardcoded assumptions

Two sections render differently depending on real screenshot availability rather than assuming screenshots always exist:
- **Hero** (`app/page.tsx`): `hasHeroScreenshot = Boolean(getApprovedScreenshot(HERO.screenshotId))` — two-column layout only when true, otherwise a narrower single-column layout so there's no empty void (see `implementation-summary.md` defect #2).
- **Flagship workflow**: `approvedWorkflowScreenshotIds` filters `FLAGSHIP_WORKFLOW_SECTION.screenshotIds` down to only the ones actually approved — same single/two-column behavior.

As of this phase, all 4 referenced screenshot IDs (`crm-pipeline-board`, `sales-quotation-detail`, `sales-order-detail` — `crm-pipeline-board` is used in both hero and flagship-workflow) are approved, so both sections render their full two-column layout in production. The conditional logic remains in place as the correct, honest behavior for any future screenshot that hasn't been approved yet.
