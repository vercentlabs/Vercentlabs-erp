# Parallel AI Implementation Operating Model

Status: `BASELINED_FOR_PARALLEL_GOVERNANCE`
Accountable owner: `Project Manager`

## Purpose

This document governs concurrent AI engineering execution inside the frozen Vercentlabs ERP architecture. It does not redefine canonical product scope, canonical implementation waves, module ownership, database invariants, the Experience Kernel, test standards, or Project Manager accountability.

Parallel execution is **not authorized merely because this document exists**. Before any new implementation package becomes `ACTIVE`, the parallel-governance validators must be installed and pass, the live execution state must be reconciled, canonical predecessor evidence must be satisfied, and the package must be registered with an isolated branch/worktree and non-conflicting ownership.

## Three separate concepts

### 1. Canonical Implementation Wave

Only these identifiers are valid implementation-wave authority:

`T00`, `T01`, `W01`–`W15`.

`docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv` is the canonical planning authority for wave scope and dependencies. The canonical IDs are zero-padded. Informal scheduling labels such as `Wave 0`, `Wave 1`, or `Wave 2` are prohibited for active implementation planning.

### 2. Specification Pass

Historical research/specification passes such as `CRM Pass 1` and `Sales Pass 2` describe specification work. They do **not** authorize implementation sequencing and are not aliases for canonical waves.

### 3. Agent Work Package (AWP)

An AWP is the executable unit assigned to an AI engineering agent. Examples:

- `AWP-W03-F001-01`
- `AWP-W03-F002-01`
- `AWP-W02-STOCK-01`
- `AWP-W02-LEDGER-01`

An AWP always names its canonical wave explicitly. Agents are assigned an AWP, never an informal numeric “wave”.

## Accountability and WIP

The Project Manager remains the sole accountable human for scope, sequencing, architecture governance, quality, integration, acceptance, risk, procurement, change control, migration/release readiness and gate decisions.

Two WIP concepts are intentionally separate:

- `PM integration/acceptance WIP = 1` — only one package is integrated/accepted at a time.
- `AI execution WIP` — multiple registered, dependency-safe, conflict-free packages may execute concurrently.

AI execution never transfers ownership or approval authority away from the Project Manager.

## Eligibility and dependency DAG

A package may become `READY`/`ACTIVE` only when all of the following are true:

1. the AWP exists in `AGENT_WORK_PACKAGE_REGISTER.csv`;
2. the AWP references a valid canonical wave;
3. canonical predecessor gates required by that wave have objective PASS evidence;
4. package-level dependencies are satisfied;
5. active owned paths do not overlap another active package;
6. any migration prefix is centrally reserved before SQL is created;
7. required shared/global changes are separated into an authorized integration/shared-platform package;
8. the branch/worktree and base commit are registered;
9. the current branch matches the registered branch;
10. the parallel-governance and package-scope validators pass.

`sequence` is a topological/reference ordering. `depends_on` is the authoritative start gate. Parallelism must never weaken dependencies to increase throughput.

## Runtime execution-register states

Allowed `execution_status` values:

- `RECONCILIATION_REQUIRED`
- `NOT_STARTED`
- `READY`
- `IN_PROGRESS`
- `BLOCKED`
- `CANDIDATE_COMPLETE`
- `COMPLETE`

Allowed `exit_gate_status` values:

- `NOT_EVALUATED`
- `PENDING`
- `PASS`
- `FAIL`

A wave may be `COMPLETE` only when `exit_gate_status=PASS`. Initial bootstrap rows are `RECONCILIATION_REQUIRED` unless objective evidence is explicitly reconciled.

## Work-package lifecycle

Normal lifecycle:

`DRAFT → READY → ACTIVE → READY_FOR_INTEGRATION → INTEGRATED → VERIFIED → CLOSED`

Additional states:

- `BLOCKED`
- `CANCELLED`

A package reaching `CLOSED` proves only that package. It never automatically makes its canonical wave `COMPLETE`.

## Branch/worktree rule

One work package = one isolated branch = one isolated worktree.

Recommended branch convention:

`awp/<lowercase-work-package-id>-<short-slug>`

Example:

`awp/w03-f002-01-accounts`

Before the branch/worktree is created, the Project Manager/integration owner must register the package, reserve migrations if needed, commit the governance assignment, and capture the package base commit.

Feature agents must not implement from the shared main worktree.

## Base-commit pinning and stale branches

Each package records an explicit `base_commit` that must be an ancestor of its branch. Before integration, the integration owner compares the package against current main and revalidates it after rebasing or merging current integration state as appropriate.

Passing tests on an obsolete base does not constitute integration evidence.

## Path ownership

Each AWP declares exact owned path prefixes. Agents may read the repository but may write only inside their owned paths.

Prefer narrow ownership, for example:

```text
services/api/src/modules/crm/leads
apps/web/src/modules/crm/leads
services/api/tests/f001-...
```

Do not give two concurrent packages the same broad module root when narrower ownership is possible.

For packages in `ACTIVE` or `READY_FOR_INTEGRATION`, identical, parent/child or otherwise overlapping owned paths are conflicts unless a dedicated integration package explicitly owns the shared change.

## Central governance files are PM/Integration-owned

Ordinary feature packages treat the following as read-only:

- `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv`
- `docs/02-register/IMPLEMENTATION_SEQUENCE_BASELINE.csv`
- `docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv`
- `docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv`
- `docs/02-register/MIGRATION_RESERVATION_REGISTER.csv`
- `docs/00-program/PM_PLANNING_BASELINE.md`
- `docs/00-program/CURRENT_REBUILD_CHECKPOINT.md`

Only PM/integration/governance work may modify central execution authority.

## Shared hot-file policy

Feature agents must not directly modify shared/global hotspots without explicit integration authorization. Typical hotspots include:

- root `package.json` and `pnpm-lock.yaml`;
- shared UI/type/public-contract packages;
- permission catalogues;
- route/module registries;
- `services/api/src/core` and `apps/web/src/core`;
- global configuration;
- canonical PM/governance registers;
- cross-module orchestration used by multiple packages.

If a feature package discovers a required shared change, it records the dependency and requests a dedicated `INTEGRATION` or `SHARED_PLATFORM` package. Dependent packages rebase/revalidate after that shared change integrates.

## Cross-module architecture

Parallelism does not change system-of-record ownership:

- each module owns its private truth;
- other modules communicate through approved public contracts;
- multi-module coordination belongs in orchestration;
- direct cross-module table ownership shortcuts remain prohibited.

## Migration reservations

Reservation status values are `RESERVED`, `CONSUMED`, `RELEASED`, and `CANCELLED`.

Before an agent creates a migration it must hold a reservation in `MIGRATION_RESERVATION_REGISTER.csv`.

Rules:

- one active reservation per database scope/prefix;
- scope is `PLATFORM` or `TENANT`;
- a reservation references a registered AWP;
- `RESERVED` prefixes must not already exist on disk;
- `CONSUMED` reservations must correspond to the migration produced by that package;
- abandoned unused reservations become `RELEASED` or `CANCELLED`;
- merged/applied historical migrations are never renumbered or modified to resolve a collision.

The reservation system governs new migrations after this governance baseline. It does not fabricate historical reservations for migrations that predate the register.

## UI / Experience Kernel rule

Every AWP touching UI declares `touches_ui=YES` and retains the approved Experience Kernel, including loading, empty, permission, error, stale/conflict, pending, responsive and accessibility states plus required visual verification.

Feature packages must not create new global button, form, typography, color-token, modal, grid, table or navigation systems. Such changes require a dedicated shared-platform/integration package.

## Database and write standards remain unchanged

Parallel execution retains all frozen database and write controls, including organization ownership, RLS, explicit concurrency, decimal-safe money, quantity/UOM precision, immutable/reversal-oriented posted truth, forward-safe migrations, transaction-scoped tenant context, locking/version guards, idempotency, audit/outbox and rollback/reconciliation behavior.

Tests must continue to include authorization negatives, retries, concurrency, migration safety, reconciliation, E2E and accessibility where applicable.

## Evidence

Each package writes package-specific evidence under a unique path such as:

`docs/08-implementation-plans/evidence/<AWP-ID>.md`

The evidence packet records requirements satisfied, files changed, migration reservations/consumption, focused tests, repository gates, screenshots where required, risks, rollback/reconciliation notes and integration results.

## Integration is serialized

For each package:

1. the agent stops edits and marks it `READY_FOR_INTEGRATION`;
2. package-scope validation passes;
3. the integration owner compares it with current main;
4. shared/public contract changes are resolved intentionally;
5. package tests rerun against integrated code;
6. repository architecture/database/security/release gates run as required;
7. the package merges;
8. evidence is recorded;
9. the work-package register is updated;
10. the execution register is updated;
11. only then is the next ready package integrated.

## Package completion versus wave completion

`VERIFIED`/`CLOSED` means the AWP is verified/closed.

A canonical wave becomes `COMPLETE` only when its full wave exit gate passes and `IMPLEMENTATION_EXECUTION_REGISTER.csv` records `exit_gate_status=PASS`. Code existence, routes, migrations or individual package success never imply wave or product readiness.

## Rollback, abandonment and cancellation

A blocked or abandoned package must stop changing owned paths. Its branch/worktree is retained until the Project Manager decides whether to rebase, supersede or cancel it. Unused migration reservations are released/cancelled; consumed/merged migration history remains immutable. Central registers are updated only by PM/integration/governance work.

## Runtime execution-state reconciliation

The repository contains implementation activity that predates this live execution register. Therefore the initial execution register uses `RECONCILIATION_REQUIRED` rather than fabricating historical completion.

Before additional parallel packages are authorized:

1. install the machine governance controls;
2. reconcile objective repository evidence for T00/T01/W01/W02/W03 and other affected waves;
3. evaluate predecessor and exit gates;
4. update `IMPLEMENTATION_EXECUTION_REGISTER.csv` from evidence;
5. register dependency-safe AWPs;
6. then authorize parallel execution.

## No-calendar-timeline policy

`NO_CALENDAR_TIMELINE_BASELINED` remains unchanged. Parallelism changes execution concurrency only; it does not create start dates, finish dates, deadlines, durations, effort-hour estimates or delivery forecasts.
