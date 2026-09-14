# UI Rewrite Tracker

Durable execution log for the frontend design-system rewrite, mirroring the
convention already established by `docs/ERP_COMPLETION_EXECUTION_TRACKER.md`
for the backend completion program. This file is the **run log**: what has
actually been done, what decisions were made and why, and the exact next
action for whoever (human or another agent session) continues this work.
It is not a substitute for the machine-readable
`docs/ux/UX_TRACEABILITY_REGISTER.csv` — that CSV is the source of truth for
per-requirement coverage; this file is prose narrative around it.

**Read this file's own honesty rule before editing it:** never mark a phase
"complete" here unless `pnpm verify:ux-coverage`'s Section B numbers for
that phase's scope actually show it. This program's entire premise (an
18,870-row machine-checkable register) exists specifically so completion
claims can be verified instead of asserted.

## Scale reality check

This is a full redesign of a 510-feature, 12-module, 98-capability-group
enterprise ERP: 18,870 atomic requirements, ~5,100 flows, ~4,080 semantic
subcapabilities. It is not achievable in one session or even one week of
sessions. Each session should: (1) read this file plus the traceability
CSV, (2) pick up the next incomplete phase/capability, (3) do real,
verified work, (4) update both artifacts, (5) commit. Do not attempt to
"finish" the whole program in a single sitting — that produces exactly the
fabricated-completion outcome this tracker exists to prevent.

## Session 2026-09-14 — Phase 0 + ADR + foundation start

### Governance decision (recorded, binding)

The repository had a **frozen** architecture decision
(`docs/01-standards/TECH_STACK_ADR.md`, `APPROVED_FOR_ARCHITECTURE_FREEZE`)
mandating the existing `@vercentlabs/shared-ui` + "Experience Kernel" as the
single web design authority, and explicitly prohibiting adding a new design
system "merely for convenience." The rewrite brief requested adopting an
entirely new stack (Tailwind v4, Base UI, TanStack Table/Form/Query/Virtual,
Recharts, dnd-kit, FullCalendar, React Flow, Tiptap, Dexie, Serwist). These
directly conflict. The product owner was asked to choose between (a) stay
inside the frozen stack, (b) full new stack, (c) narrow hybrid (keep the
Experience Kernel, add only TanStack Table+Virtual for the grid). **The
owner chose (b), full new stack**, on 2026-09-14.

This is recorded in `docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md`,
which supersedes the "Shared UI" row of the original ADR and the
"Design-system rule" section of `docs/01-standards/WEB_FRONTEND_ARCHITECTURE.md`
(both amended in place with pointers to ADR-002, not deleted — the original
historical record stays intact). Every other frozen row (runtime, database,
`services/api`/`services/worker` architecture, permissions, workflows,
reporting/document/localization/observability packages, business-authority
boundary) is explicitly **not** touched by this decision.

### Starting state found (before assuming anything from the brief)

The brief's own framing ("no design tokens exist", "12 unrelated
applications") turned out to be **not fully accurate** — verified by reading
actual repo state rather than the brief's assumptions:

- A real token pipeline already existed:
  `packages/shared-ui/tokens/theme.json` (a single structured JSON source,
  version `2026.09.11`) → `scripts/design/generate-theme.mjs` generates
  `apps/web/src/shared/design/tokens.css` (`--erp-*` CSS custom properties)
  AND `apps/mobile/src/shared/theme/tokens.ts` (native palette/spacing/
  radii/type-scale). This is genuinely one source of truth already — kept,
  not replaced; `packages/design-tokens` (per ADR-002) wraps/extends it
  rather than starting over.
- An "Experience Kernel" already existed:
  `apps/web/src/shared/design/experience-kernel.module.css` (848 lines),
  `page-archetypes.module.css`, `dialog.module.css`,
  `convergence-boundary.module.css` — a real, if incomplete, design-system
  layer.
- The real legacy-CSS problem is narrower than assumed but still real:
  7 files (`globals.css` 4,359 lines, `operator-workbench.css` 1,538,
  `enterprise-modules.css` 1,255, `workspace-redesign-v3.css` 947,
  `navigation-v2.css` 799, `billing-extension.css` 279,
  `business-data-extension.css` 372 — `accounting-extension.css`,
  `procurement-extension.css`, `sales-extension.css` are already-emptied
  2-3 line stubs) define **47 distinct legacy `--color-*`/`--v2-*` token
  names** alongside the 91 `--erp-*` tokens, confined to the global/shell
  layer under `apps/web/src/app/*.css`, not spread across all 12 modules'
  own (mostly CSS-Modules-scoped) styling.
- `apps/web`'s actual dependencies before this session: `next`, `react`,
  `zod` only. No Tailwind, no Radix/Base UI, no TanStack anything, no
  charting/grid/calendar library. `packages/shared-ui/src/index.js` is 18
  lines, 3 tiny helper components (`StatusBadge`, `EmptyState`,
  `FieldError`) — not a real component system.
- All 510 features are already organized into 98 real capability-group
  folders per module (documented in `WEB_FRONTEND_ARCHITECTURE.md`), so
  Phase 0's module→capability mapping did not need to be invented.

### Phase 0: UX traceability register — DONE (structural), ongoing (migration mapping)

Built `scripts/ux/generate-ux-traceability.mjs`, which reads
`SUBREQUIREMENT_REGISTER.csv` (18,870 rows) + `FEATURE_REGISTER.csv` and
produces `docs/ux/UX_TRACEABILITY_REGISTER.csv` — every requirement
classified `DIRECT_UI` / `AFFECTS_UI_STATE` / `NO_DIRECT_UI` by a
reproducible, auditable heuristic keyed on the register's own frozen
`requirement_type` taxonomy (CAP/FR/US/FLOW/UX/APP/REP → DIRECT_UI;
BR/DATA/VAL/CALC/SEC/AUTO/NOTIF/AI/PERF → AFFECTS_UI_STATE;
INT/API/OBS/E2E/UAT → NO_DIRECT_UI, each with an explicit machine-written
reason), plus keyword-based approval/destructive/offline heuristics. Result:

| ui_relevance | count |
|---|---|
| DIRECT_UI | 7,314 |
| AFFECTS_UI_STATE | 6,966 |
| NO_DIRECT_UI | 4,590 |
| **Total** | **18,870** |

**What this genuinely proves today:** every one of the 18,870 rows has a
classification and (for NO_DIRECT_UI) a reason — this is real and
re-verified by `pnpm verify:ux-coverage` (Section A, hard-fail).
**What it does NOT yet prove:** that any of the 7,314 DIRECT_UI rows has an
actual designed screen/component. Those columns
(`ui_archetype`/`route_or_surface`/`web_component`/`design_status`/
`implementation_status`/`test_status`/`storybook_story`/`e2e_test`/
`accessibility_test`) start `NOT_STARTED`/blank and are the real, large
remaining body of work (Section B of `verify:ux-coverage`, report-only,
7,314/7,314 unmapped at the start of this program — see exact per-module
breakdown by running the script).

Built `scripts/ux/verify-ux-coverage.mjs` (`pnpm verify:ux-coverage`).
**Deliberately not wired into the aggregate `pnpm verify` chain** — Section
B would fail the whole build for the entire rewrite program's duration,
which would either get the check disabled (defeating its purpose) or block
unrelated backend work. Promote specific modules' Section B checks to
hard-fail once `UI_REWRITE_TRACKER.md` records that module as migrated —
see the script's own header comment.

**Real gap found by Section A, not yet closed:** 14 of the 36 SP
requirement documents (SP001, SP002, SP003, SP004, SP005, SP006, SP007,
SP010, SP011, SP013, SP026, SP029, SP032, SP035) are never referenced by
`FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv`'s `shared_platform_dependencies`
column — because they're foundational/cross-cutting platform concerns
(tenant/org/company/branch/identity/auth/session/MFA, module entitlements,
billing, workflow engine, config/feature-flags, security governance,
**accessibility**, release safety) rather than something individual feature
capabilities declare a dependency on. `verify:ux-coverage` correctly
reports this as a real, current gap: these 14 SPs have **no atomic
requirement rows at all** in the CSV-driven register the way F001-F510 do
(their requirements live only as markdown prose in
`docs/04-shared-platform/requirements/SP0##-*.md`). Closing this properly
means extracting atomic UX-relevant requirements from those 36 markdown
documents into the same rigor as `SUBREQUIREMENT_REGISTER.csv` — a
real, separately-scoped follow-on task ("Phase 0b: SP atomic requirement
extraction"), not yet started. Do not force this check to pass by loosening
it; do not fabricate SP-level rows without actually reading each SP
document.

### Phase 1: foundation — STARTED

See "Immediate next action" below for exact state.

## Module-by-module DIRECT_UI mapping coverage (from `verify:ux-coverage` Section B)

Run `pnpm verify:ux-coverage` for current numbers — do not hand-copy stale
numbers here as sessions progress; this table is a snapshot of the
**starting** state only (2026-09-14, before any migration):

| Module | DIRECT_UI requirements | Mapped |
|---|---|---|
| CRM | 450 | 0 |
| Sales | 480 | 0 |
| Procurement | 510 | 0 |
| Stock / Inventory | 720 | 0 |
| Manufacturing | 720 | 0 |
| Projects | 570 | 0 |
| Assets | 555 | 0 |
| Point of Sale | 600 | 0 |
| Quality | 525 | 0 |
| Support / Customer Service | 494 | 0 |
| HR & Payroll | 936 | 0 |
| Accounting / Finance | 754 | 0 |
| **Total** | **7,314** | **0** |

## Phase order (from the rewrite brief, adapted to this repo's real structure)

0. Traceability register — **structural part done**, migration-mapping ongoing.
0b. SP001-SP036 atomic requirement extraction — **not started**.
1. Tokens and foundations (`packages/design-tokens`, Tailwind v4 bridge) — **in progress**.
2. Primitive components (`packages/ui-web/src/primitives`) — not started.
3. Application shell/navigation/context — not started.
4. Enterprise grid (TanStack Table + Virtual) — not started.
5. Forms and transaction editor (TanStack Form) — not started.
6. Record 360 and list archetypes — not started.
7. Shared-platform UX (approvals/audit/files/notifications/jobs/import-export/permissions/effective-dating/search) — not started.
8. Specialist archetypes (board/calendar/Gantt-adapter/graph/reconciliation/scanner/POS/batch/conversation/inspection) — not started.
9. Golden reference implementations (one hard screen per module) — not started.
10. Migrate all remaining features — not started.
11. Remove obsolete CSS/components/tokens — not started (nothing may be removed before its replacement is in active use).
12. Full regression + UX traceability verification — not started.

## Legacy CSS/tokens remaining (delete only after real replacement is live)

- `apps/web/src/app/globals.css` (4,359 lines)
- `apps/web/src/app/operator-workbench.css` (1,538 lines)
- `apps/web/src/app/enterprise-modules.css` (1,255 lines)
- `apps/web/src/app/workspace-redesign-v3.css` (947 lines)
- `apps/web/src/app/navigation-v2.css` (799 lines)
- `apps/web/src/app/business-data-extension.css` (372 lines)
- `apps/web/src/app/billing-extension.css` (279 lines)
- 47 distinct legacy `--color-*`/`--v2-*` custom-property names defined across the above.

## Known blockers

- DHTMLX Gantt cannot be adopted without a signed commercial license (GPL
  terms are incompatible with a closed-source product) — see ADR-002's
  `SchedulingAdapter` interim plan.
- SP001-SP036 have no CSV-parseable atomic-requirement source yet (Phase 0b).
- This program's true size (18,870 requirements) means "done" is a
  multi-session, likely multi-week-of-agent-time destination — track
  fractional progress honestly rather than declaring early completion.

## Immediate next action for whoever continues this

1. Finish Phase 1: add the new dependencies to `apps/web` (Tailwind v4,
   Base UI, lucide-react, `@tanstack/react-table`, `@tanstack/react-virtual`,
   `@tanstack/react-form`, `@tanstack/react-query`, recharts, `@dnd-kit/core`),
   wire Tailwind's `@theme` to read from the existing `--erp-*` tokens (do
   not create a second, competing token source), confirm `pnpm build:web`
   still passes.
2. Build the first 3-5 real `packages/ui-web` primitives (Button, Input,
   Badge/StatusBadge migrated from `shared-ui`, Dialog) each with a real
   Storybook story and an axe check, proving the stack works end-to-end
   before scaling to the full primitive list.
3. Start Phase 0b (SP atomic requirement extraction) in parallel if a
   second work-stream is available — it blocks the SP001-SP036 coverage
   check from ever going green otherwise.
4. Pick ONE golden-reference screen (CRM Lead 360 is the natural first
   candidate — smallest, most-trafficked, already has real backend
   contracts from this program's earlier CRM completion pass) and migrate
   it fully, updating its rows in `UX_TRACEABILITY_REGISTER.csv` to
   `implementation_status=DONE` with real `route_or_surface`/
   `web_component`/`storybook_story`/`e2e_test` values, before touching a
   second screen. Resist the urge to touch many screens shallowly.
