# Change Control

Status: `PM_BASELINE_FROZEN`
Accountable owner: `Project Manager`

Changes to canonical IDs, names, module ranges/counts, canonical wave scope/dependencies or architecture invariants require explicit Project Manager approval and a documented decision. Material requirement changes must update traceability, capability packs, dependency impact, cost/procurement impact, test plans and UAT criteria.

After architecture/planning freeze, no AI session or implementation command may silently change frozen scope, wave authority, security/accounting/inventory/payroll/tax invariants, dependency sequence, paid-spend authorization or `NO_CALENDAR_TIMELINE_BASELINED`.

## Parallel execution change control

Ordinary FEATURE packages must treat central governance registers and shared/global hotspots as read-only. If a package requires a shared/public-contract/global change, it records the dependency and requests a dedicated `INTEGRATION` or `SHARED_PLATFORM` work package rather than expanding its own scope.

Only PM/integration/governance work may modify central execution/AWP/migration authority. Branch/base-commit changes, path-ownership changes and migration reservation changes are recorded before affected package work continues.

If the Project Manager later chooses to change accountability, PM integration WIP, parallel execution policy or introduce any calendar commitment, that is a material planning change and must be explicit rather than inferred.
