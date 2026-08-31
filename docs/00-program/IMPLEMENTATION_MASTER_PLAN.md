# ERP Implementation Master Plan

Status: `PLANNING_CLOSURE`

## Execution principle
Implement by coherent capability waves and dependency order, not F-ID order. F001-F510 remain traceability anchors.

## Stage gates
1. Planning closure: module specs, shared-platform authority, enterprise journeys, architecture standards, Experience Kernel, test traceability and zero P0/P1 freeze blockers.
2. Architecture freeze: public module boundaries, transaction/RLS model, event/idempotency patterns, data conventions and UX kernel frozen.
3. Foundation implementation: tenancy/auth/permissions/audit/jobs/files/configuration/observability plus Experience Kernel.
4. Capability waves: implement business capabilities with DB/API/UI/tests/UAT and cross-module contracts together.
5. Journey certification: happy/failure/retry/reversal/reconciliation E2E plus human UAT.
6. Enterprise hardening: security, scale, accessibility, DR, migration, operations and AI safety.
7. Pilot/cutover: migration rehearsal, reconciliation, pilot acceptance, rollback readiness and hypercare.

## Exit rule
No implementation wave is COMPLETE because code merged. Completion requires capability acceptance criteria, negative authorization tests, data/state invariants, integration reconciliation, responsive/accessibility evidence and UAT.
