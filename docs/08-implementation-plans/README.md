# Implementation Plans

This directory contains implementation-package plans and evidence. It is governed by the canonical wave authority and the parallel AI operating model.

## Naming authority

### Canonical implementation waves

Use only `T00`, `T01`, `W01`–`W15`. Canonical scope/dependencies come from `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv`.

Do **not** use informal plain numeric wave labels for active implementation plans; canonical zero-padded IDs are mandatory.

### Specification Passes

Historical files named `*_PASS*_SPECIFICATION_REPORT.md` are specification/research artifacts only. Their Pass number is not an implementation wave.

### Agent Work Packages

Actual AI assignments use `AWP-*` IDs registered in `docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv`.

Example:

`AWP-W03-F002-01`

## Implementation-plan filename convention

Prefer canonical identifiers in filenames, for example:

- `W03_F001_LEADS_IMPLEMENTATION.md`
- `AWP-W03-F002-01_ACCOUNTS.md`
- `evidence/AWP-W03-F002-01.md`

Historical foundation artifacts that were created before canonical wave governance use descriptive `FOUNDATION_*` names rather than pretending to be canonical waves.

## One package, one branch, one worktree

Every new AWP uses an isolated registered branch/worktree pinned to an explicit base commit. Feature agents do not implement in the shared main worktree.

## Path ownership

Each AWP declares narrow `owned_paths` and `forbidden_paths`. Concurrent packages must not own identical or parent/child paths. Ordinary feature agents may read but may not edit central PM/governance registers.

## Migration reservation

A package that needs a migration must reserve the platform/tenant prefix in `MIGRATION_RESERVATION_REGISTER.csv` **before** creating the SQL file. Never guess the next migration number and never renumber applied history.

## Shared-change escalation

If a feature package needs to modify a shared/global hotspot or public contract, it must stop that shared change and request a dedicated `INTEGRATION`/`SHARED_PLATFORM` package. Dependent feature packages rebase and revalidate afterward.

## Evidence

Package-specific evidence belongs under `docs/08-implementation-plans/evidence/<AWP-ID>.md`. Package evidence does not automatically complete its canonical wave.

## Runtime authority

Planning status lives in the canonical wave registers. Runtime wave status lives in `IMPLEMENTATION_EXECUTION_REGISTER.csv`. Agent assignment/status lives in `AGENT_WORK_PACKAGE_REGISTER.csv`.

During governance rollout, no new package becomes ACTIVE until machine validators are installed and execution-state reconciliation is complete.
