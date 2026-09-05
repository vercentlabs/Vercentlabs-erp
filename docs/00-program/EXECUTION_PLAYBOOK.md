# Vercentlabs ERP — End-to-End Execution Playbook

Status: `ACTIVE_EXECUTION_AUTHORITY`

## 1. Purpose

This document converts the already-complete product/specification blueprint into a repeatable implementation workflow that can continue across new ChatGPT conversations without rewriting the prompt.

The product scope remains the canonical F001-F510 ERP, with SP001-SP036 shared-platform requirements, 98 capability groups, semantic sub-capabilities, atomic requirements, failure-aware flows, state machines, cross-module journeys and test traceability already present in the repository.

## 2. Non-negotiable truth model

1. F001-F510 are traceability IDs, not source-code folders.
2. Product implementation follows coherent business capabilities and public module contracts.
3. Existing code is evidence, never automatic proof of readiness.
4. No feature or wave becomes accepted because a route/table/button/test exists.
5. Server-side authorization, tenant/company/branch scope, data invariants, audit, idempotency, recovery and reconciliation remain mandatory where applicable.
6. The Experience Kernel and project structure standards remain authoritative for UI/architecture consistency.
7. No production/user compatibility promise is inferred before pilot/production; see `PRE_PRODUCTION_EVOLUTION_POLICY.md`.

## 3. Canonical implementation order

The dependency DAG in `IMPLEMENTATION_WAVE_REGISTER.csv` is authoritative:

`T00 -> T01 -> W01/W02/W03 ... -> W12 -> W13 -> W14 -> W15`

Never choose a wave because its F-IDs are numerically first. Use predecessor gates and `next_execution_step.py`.

## 4. Exactly five implementation GOs per wave

Every executable implementation wave is converged through five externally visible GOs. Existing pre-playbook work is reconciled into these GOs; it is not rewritten merely to satisfy the format.

### GO1 — Repository reconciliation, architecture, data and invariants

ChatGPT must:

- load the wave's feature dossiers, sub-capabilities, flows, states, dependencies, journeys and current code;
- identify existing implementation vs missing/incorrect implementation;
- resolve capability/module ownership and final file placement;
- implement/refactor database schema, migrations, constraints, RLS, indexes, deterministic calculations and foundational models where needed;
- preserve migration history; never renumber an applied migration;
- establish objective GO1 tests for data/security invariants.

### GO2 — Domain backend, commands/queries and transport

Implement/refactor:

- domain rules and lifecycle/state machines;
- commands/queries/public contracts;
- authorization/record/field scope;
- concurrency/idempotency/audit/outbox behavior;
- thin APIs/routes/adapters;
- API/DB/permission-negative tests.

### GO3 — Complete user experience

Implement/refactor the complete approved user-facing experience:

- desktop/tablet/mobile-responsive web surfaces;
- native mobile/offline only where the feature classification requires it;
- Experience Kernel/design-system composition instead of parallel UI patterns;
- list/work queue, record 360, document, board, calendar, dashboard or operational workbench archetypes as required by the dossiers;
- loading, empty, error, permission, conflict, pending, partial-failure and offline states as applicable;
- accessibility and keyboard/touch behavior;
- no new design debt to hide implementation gaps.

### GO4 — Cross-module integration, async behavior and adversarial hardening

Close the hard cases:

- public-contract integration and orchestration;
- worker/outbox/job behavior;
- integrations and provider uncertainty;
- retry, duplicate submission, concurrency, stale state, partial failure, reversal and reconciliation;
- security/tenant escape and data-leak attempts;
- representative scale/performance tests;
- cross-module journey tests for wave-owned paths.

### GO5 — Full convergence and candidate evidence

GO5 is not a place to add known unfinished functionality. It must:

- close all known wave gaps;
- run the smallest complete deterministic verification set plus the wave/repository gate;
- run browser E2E/visual/responsive/accessibility checks required by the wave;
- reconcile feature/wave progress registers;
- produce the wave evidence packet;
- leave the wave as `CANDIDATE_COMPLETE`, never human-approved automatically.

## 5. What one ChatGPT GO response must do

For GO1-GO5 ChatGPT must output **one Git Bash command** that is safe to run from repo root and that:

1. uses `set -euo pipefail`;
2. verifies it is in the expected repository;
3. audits/reuses existing files instead of blindly generating duplicates;
4. applies only the current GO's coherent scope;
5. runs formatter/type/lint/test/migration/architecture checks appropriate to that GO;
6. fails on verification failure;
7. updates execution evidence/status only after the corresponding checks pass;
8. prints a concise completion summary and next stage.

Large waves may use internal capability batches **inside the same GO command**, but the externally visible wave still has GO1-GO5 only.

## 6. Independent Codex QA gate — mandatory after GO5

After GO5, implementation stops. Codex becomes an independent tester under `CODEX_WAVE_QA_PROTOCOL.md`.

Codex must test the **whole wave like a real operator**, not merely rerun unit tests. It must cover every in-wave feature and its relevant semantic/flow/state obligations, including role/permission negatives and recovery paths.

Codex outcome is exactly one of:

- `PASS` — no unresolved reproducible defect that contradicts the approved requirements/user flows;
- `FAIL` — defects are documented with reproducible steps, feature IDs, severity, expected vs actual behavior and evidence.

Codex does not silently edit/fix the implementation it is judging.

## 7. Defect loop

When Codex reports FAIL:

1. record defects in `DEFECT_REGISTER.csv`;
2. the owner provides the Codex report/repo to ChatGPT;
3. ChatGPT audits each defect and emits one Git Bash **fix command**;
4. run deterministic regressions;
5. rerun the **entire Codex wave QA**, not only the failing test;
6. repeat until Codex reports PASS.

No human final acceptance starts while Codex QA is FAIL/PENDING.

## 8. Final human UAT/owner approval

After Codex PASS, the project owner becomes the final human tester under `HUMAN_UAT_PROTOCOL.md`.

The owner must actually use every feature in the wave through realistic business journeys and record PASS/FAIL. If the owner finds a defect, the wave returns to the defect loop and Codex must re-pass after the fix.

A feature becomes `OWNER_APPROVED` only through explicit human acceptance. A wave becomes final only when all applicable features/capabilities/journeys are approved and its canonical exit gate is updated to PASS.

## 9. No-real-users / change-friendly operating policy

This product is currently pre-production with no external production users. Therefore:

- optimize for the best architecture, UX and domain correctness rather than preserving weak accidental behavior;
- refactor aggressively when evidence shows a better solution;
- do not preserve design debt simply for backward compatibility;
- still protect migration history, test fixtures, data integrity, secrets and irreversible operations;
- once pilot/production begins, compatibility/migration policy must be explicitly tightened.

## 10. Progress and status

Progress is recorded, not inferred:

- wave planning/dependencies: `IMPLEMENTATION_WAVE_REGISTER.csv`;
- canonical runtime wave gate: `IMPLEMENTATION_EXECUTION_REGISTER.csv`;
- five-go/Codex/human progress: `WAVE_GO_EXECUTION_REGISTER.csv`;
- feature-by-feature state: `FEATURE_EXECUTION_STATUS.csv`;
- defects: `DEFECT_REGISTER.csv`;
- human evidence: `docs/10-uat/evidence/`;
- automated/Codex evidence: `docs/08-implementation-plans/evidence/` and `docs/09-test-plans/evidence/`.

`EXECUTION_DASHBOARD.md` is generated from these authorities and must not become a hand-edited source of truth.

## 11. New-chat autopilot

In every new chat, the assistant should run/read:

```bash
python docs/scripts/next_execution_step.py
```

Then continue the returned wave/stage. The owner should not need to reconstruct the plan from conversation memory.
