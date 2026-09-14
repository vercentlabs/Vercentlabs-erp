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
that phase's scope actually show it. This program's entire premise (a
20,958-row machine-checkable register, as of Phase 0b — 18,870 F rows +
2,088 SP rows) exists specifically so completion
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

### Phase 0b: SP001-SP036 atomic requirement extraction — DONE (structural)

Read all 36 dossiers in full before writing any parser. Ground truth
established directly from the text (not assumed): every one of the 36
dossiers shares one exact **54-section** template
(`## [SPEC-<SLUG>] <Title>`, verified with `grep -c`). Only **3** of those
54 sections declare genuinely enumerated atomic requirement IDs shaped
like the F-register's own `SP###-TYPE-###`:

- `[SPEC-FUNCTIONAL]` → exactly 3 IDs, `SP0##-FR-001..003`
- `[SPEC-E2E]` → exactly 2 IDs, `SP0##-TEST-E2E-01..02`
- `[SPEC-UAT]` → exactly 2 IDs, `SP0##-UAT-01..02`

= **7 enumerated atomic requirements per dossier, 252 total**, uniform
across all 36 files. The other **51 sections per dossier** are real,
substantive, human-authored normative prose that is genuinely NOT broken
into individually numbered atomic requirements. Per the explicit
instruction not to fabricate false granularity, each such section becomes
exactly **one** row, with a requirement_id built from a `SECTION` marker
(e.g. `SP001-SECTION-SECURITY`) that can never be mistaken for an
author-enumerated ID — 51 × 36 = **1,836 section-level rows**.
**Total SP atomic requirements: 2,088** (252 enumerated + 1,836
section-level). Do not quote 18,870 as the total requirement count going
forward — see the header note above.

Built `scripts/ux/extract-sp-requirements.mjs` →
`docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv` (schema:
`requirement_id, sp_id, requirement_family, enumerated, title,
normative_statement, priority, category, dependencies, source_dossier`).
`normative_statement` is always the section's real prose, verbatim, never
generated text. The parser hard-asserts 54 sections per file and warns if
the enumerated count isn't exactly 252 — it already caught two real bugs
in its own first draft this way (a digit in an `E2E` slug excluded by an
overly strict character class, and multi-segment `SRC-*` benchmark
citations like `SP007-SRC-SP-NIST-63B-4` not matching an exact `"SRC"`
equality check) before either could silently corrupt the extracted counts.

Extended `scripts/ux/generate-ux-traceability.mjs` to load this SP
register alongside the existing F register and emit ONE combined
`docs/ux/UX_TRACEABILITY_REGISTER.csv` (new `source_register` column:
`F_REGISTER` / `SP_REGISTER`). SP rows are classified the same way F rows
are — a reasoned rule per `requirement_family` for the 252 enumerated rows,
and a reasoned rule per each of the 51 distinct section slugs for the
section-level rows (see `SP_SECTION_RULES` in the script — e.g.
`ACCESSIBILITY` → `AFFECTS_UI_STATE` with a note pointing at SP032's own
rows as the concrete acceptance contract; `LIST`/`DETAIL`/`CREATE`/`EDIT`/
`APPROVALS`/`AUDIT` → `DIRECT_UI`; `BENCHMARK`/`OMISSION-GATE`/`DOD`/
`CODE-AUDIT` → `NO_DIRECT_UI`, governance/process content, not UI). SP034
(the mobile/offline platform SP itself) is the one place `offline_support`
is forced to `REQUIRED` for its own DIRECT_UI/AFFECTS_UI_STATE rows,
rather than guessed from a module heuristic.

**Combined UX traceability, current real totals** (from
`pnpm verify:ux-coverage`, re-run after this change):

| | F requirements | SP requirements | Total |
|---|---|---|---|
| DIRECT_UI | (7,314 baseline, unchanged) | 648 | 7,962 |
| AFFECTS_UI_STATE | 6,966 | 648 | 7,614 |
| NO_DIRECT_UI | 4,590 | 792 | 5,382 |
| **Total** | **18,870** | **2,088** | **20,958** |

Extended `scripts/ux/verify-ux-coverage.mjs` Section A with SP-specific
hard-fail checks: all 36 SP groups present with rows, every SP group has
exactly 58 rows (7 enumerated + 51 section-level — a group with a
different count means the extractor drifted from the template
unnoticed), plus two new cross-cutting checks that apply to F **and** SP
rows alike: every UI-facing row has an explicit `phone_support`
classification, and every row has a `background_job_behavior` value
(new column, keyword-detected on `background job`/`queue`/`retry`/
`async`/`dead-letter`/`scheduled job`). **All Section A checks pass with
zero failures** — verified by actually running the script, not asserted.

**What this genuinely proves:** SP001-SP036 now have the same
machine-checkable classification discipline F001-F510 already had.
**What it does NOT prove:** that any SP's actual UX contract (e.g. SP032's
concrete accessibility acceptance criteria) has been implemented anywhere
yet — Section B shows 0/648 SP DIRECT_UI rows mapped to a real
route/component, same as F's 0/7,314, because nothing has been migrated.
SP032 specifically: 58 rows exist, 0 have an `accessibility_test` recorded
yet (see the dedicated line `verify:ux-coverage` now prints for it).

### Phase 1: foundation — first slice DONE, verified end-to-end

Added the new stack to `apps/web` and a new workspace package
`packages/ui-web` (Base UI + Tailwind v4, shadcn-style owned components):

- `apps/web/postcss.config.mjs` + `@tailwindcss/postcss` wired in.
- `apps/web/src/app/tailwind-theme.css`: Tailwind v4 CSS-first `@theme`
  block that maps every semantic family from ADR-002 (`color.background.*`,
  `color.text.*`, `color.border.*`, `color.action.*`, `color.state.*`,
  `spacing.*`, `radius.*`, `shadow.*`, `control.*`, `typography.*`,
  `motion.*`, `zIndex.*`) onto the **existing** `--erp-*` custom properties
  generated by `scripts/design/generate-theme.mjs`. This is a bridge, not a
  second token source — Tailwind utilities (`bg-canvas`, `text-primary`,
  etc.) resolve to the same values the CSS-module Experience Kernel already
  uses. Extend `packages/shared-ui/tokens/theme.json` (and regenerate) when
  a new token is needed, never hardcode a value in this bridge file or in a
  component.
- `packages/ui-web`: new workspace package, `@vercentlabs/ui-web`,
  peer-deps on React 19, real dependencies on `@base-ui-components/react`,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.
  First 4 real primitives, each with a passing render test
  (`packages/ui-web/tests/primitives.test.mjs`, 4/4 pass):
  - `Button` (primary/secondary/danger/ghost/link variants, compact/
    standard/large sizes, loading state)
  - `StatusBadge` (neutral/success/warning/danger/info tones — replaces
    `@vercentlabs/shared-ui`'s version for new usage; the old one stays
    for existing consumers until migrated)
  - `Input` (invalid/aria-invalid state)
  - `Dialog` (`DialogRoot`/`DialogTrigger`/`DialogContent`/`DialogTitle`/
    `DialogDescription`/`DialogFooter`/`DialogClose`) — the first real
    proof Base UI is doing real work: focus trap, inert background,
    Escape-to-close, portal, and the aria-modal/aria-labelledby/
    aria-describedby wiring all come from `@base-ui-components/react/dialog`,
    not hand-rolled.
- `apps/web/next.config.mjs`: added `@vercentlabs/ui-web` to
  `transpilePackages` (same pattern already used for `@vercentlabs/shared-ui`
  and every other internal package — these ship TS/TSX source, not
  pre-compiled output).

**Verified, not just typed:** `pnpm --filter @vercentlabs/ui-web test`
(4/4 pass, real `react-dom/server` render including the Base UI Dialog),
`pnpm --filter @vercentlabs/web typecheck` (clean), a full
`pnpm --filter @vercentlabs/web build` (production Next.js build, Turbopack,
exit 0, all 187 existing routes still build), and the existing
`pnpm --filter @vercentlabs/web test` suite (723/723, zero regressions from
adding the new stack).

**Explicitly not done yet** (do not claim otherwise): Storybook is not
configured (checked `storybook`/`@storybook/nextjs`/`@storybook/addon-a11y`
are all published and installable; deferred to keep this slice reviewable
and because a half-configured Storybook is worse than none — do it as its
own real slice); no axe/accessibility automated test yet exists for these
4 primitives; the remaining ~35+ primitives and all enterprise
components/archetypes from the brief's component registry are not started;
no module page has been migrated to consume `@vercentlabs/ui-web` yet —
these 4 primitives exist and are proven but are not yet used anywhere in
the real product.

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
- ~~SP001-SP036 have no CSV-parseable atomic-requirement source~~ — closed by Phase 0b (`docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv`).
- This program's true size (18,870 requirements) means "done" is a
  multi-session, likely multi-week-of-agent-time destination — track
  fractional progress honestly rather than declaring early completion.

## Immediate next action for whoever continues this

1. Set up Storybook for real (`storybook`, `@storybook/nextjs`,
   `@storybook/addon-a11y` all confirmed installable at time of writing)
   against `packages/ui-web`, with a real story + axe check for each of the
   4 existing primitives before adding more. Do this before growing the
   primitive count further — retrofitting stories onto 30+ components later
   is far more expensive than writing them alongside each one now.
2. Grow `packages/ui-web/src/primitives` to cover the rest of the core
   primitive list from the brief (Select, Combobox, Checkbox, RadioGroup,
   Switch, DatePicker, Popover, Tooltip, DropdownMenu, Tabs, Avatar, Toast,
   etc.) — Base UI has a matching part for nearly all of these
   (`@base-ui-components/react/select`, `/checkbox`, `/switch`, `/popover`,
   `/tooltip`, `/menu`, `/tabs`, `/toast`, ...; confirmed present in the
   installed package). Each needs the same treatment as Button/Dialog: a
   real render test minimum, a Storybook story once Storybook exists.
3. ~~Start Phase 0b~~ — done (see Phase 0b section above).
4. Pick ONE golden-reference screen (CRM Lead 360 is the natural first
   candidate — smallest, most-trafficked, already has real backend
   contracts from this program's earlier CRM completion pass) and migrate
   it fully onto `@vercentlabs/ui-web`, updating its rows in
   `UX_TRACEABILITY_REGISTER.csv` to `implementation_status=DONE` with real
   `route_or_surface`/`web_component`/`storybook_story`/`e2e_test` values,
   before touching a second screen. Resist the urge to touch many screens
   shallowly — that produces exactly the "layer another generation on top"
   outcome this whole rewrite exists to end.
5. Only after (4) proves the pattern: build the canonical
   `EnterpriseDataGrid` on `@tanstack/react-table` + `@tanstack/react-virtual`
   (both already installed) — this is the single highest-leverage shared
   component, since nearly every module's Enterprise List archetype depends
   on it.
