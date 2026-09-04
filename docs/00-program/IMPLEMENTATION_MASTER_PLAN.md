# ERP Implementation Master Plan

Status: `PLANNING_BASELINED`

## Execution principle

Implement by coherent capability waves and dependency order, not F-ID order. F001-F510 remain traceability anchors. Canonical wave scope/dependencies come only from `IMPLEMENTATION_WAVE_REGISTER.csv`.

Actual AI execution occurs through registered Agent Work Packages under `PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md`; canonical waves are dependency/acceptance groupings, not agent assignments.

## Stage gates

1. Planning closure: module specs, shared-platform authority, enterprise journeys, architecture standards, Experience Kernel, test traceability and zero P0/P1 freeze blockers.
2. Architecture freeze: public module boundaries, transaction/RLS model, event/idempotency patterns, data conventions and UX kernel frozen.
3. Parallel-governance installation and execution-state reconciliation: machine governance controls installed; pre-existing implementation evidence reconciled into the live execution register without fabricating completion.
4. Foundation implementation: tenancy/auth/permissions/audit/jobs/files/configuration/observability plus Experience Kernel.
5. Capability waves: implement business capabilities with DB/API/UI/tests/UAT and cross-module contracts together through registered AWPs.
6. Journey certification: happy/failure/retry/reversal/reconciliation E2E plus human UAT.
7. Enterprise hardening: security, scale, accessibility, DR, migration, operations and AI safety.
8. Pilot/cutover: migration rehearsal, reconciliation, pilot acceptance, rollback readiness and hypercare.

## Parallel execution rule

- Project Manager remains sole accountable owner.
- `PM integration/acceptance WIP = 1`.
- Multiple AI AWPs may be `ACTIVE` only when canonical predecessors and package dependencies pass, owned paths do not collide, branches/base commits are registered, migrations are reserved, and shared changes are separated.
- Integration remains serialized.
- A closed package never automatically completes its canonical wave.

## Exit rule

No implementation wave is COMPLETE because code merged. Completion requires capability acceptance criteria, negative authorization tests, data/state invariants, integration reconciliation, responsive/accessibility evidence, UAT, and `exit_gate_status=PASS` in the live execution register.

## Project Manager baseline

Implementation is governed by `SOLE_PROJECT_MANAGER_OPERATING_MODEL.md`, `PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md`, `SCHEDULE_MANAGEMENT_POLICY.md`, `PROJECT_CAPACITY_PLAN.md`, `PROJECT_COST_MANAGEMENT_PLAN.md`, `STAKEHOLDER_MANAGEMENT_PLAN.md`, `COMMUNICATIONS_PLAN.md`, `PROCUREMENT_EXTERNAL_SERVICES_PLAN.md` and `IMPLEMENTATION_SEQUENCE_BASELINE.csv`.

`NO_CALENDAR_TIMELINE_BASELINED` remains unchanged: dependency and evidence gates do not imply planning dates, deadlines, durations, effort-hour commitments or delivery forecasts.
