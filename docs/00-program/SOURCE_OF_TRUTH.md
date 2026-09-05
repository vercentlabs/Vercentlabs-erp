# Source of Truth

Priority order:

1. Canonical F001-F510 register and exact feature names.
2. Approved feature dossiers, shared-platform authority and capability packs.
3. Approved cross-module journey specifications, architecture decisions and final Pass-F canonical implementation-wave authority.
4. `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv` for canonical wave planning scope/dependencies.
5. `docs/02-register/IMPLEMENTATION_SEQUENCE_BASELINE.csv` for topological/reference sequence, exit-gate definition and PM integration WIP policy.
6. `docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv` for live runtime wave status after evidence reconciliation.
7. `docs/02-register/AGENT_WORK_PACKAGE_REGISTER.csv` for AI package assignment/execution authority.
8. `docs/02-register/MIGRATION_RESERVATION_REGISTER.csv` for new migration-prefix allocation authority.
9. `PM_PLANNING_BASELINE.md`, `PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md`, PM control registers and `CURRENT_REBUILD_CHECKPOINT.md` for governance interpretation.
10. Current source code as implementation evidence, never as an automatic replacement for product requirements or wave-exit evidence.
11. Official vendor/standards research recorded in the benchmark register.

Planning status and runtime execution status are intentionally separate. Ordinary feature agents may read central governance registers but must not modify them.

No F511+ identifiers may be invented for canonical product features. Nested requirement IDs use forms such as `F001-FR-001`, `F001-UX-001`, `F001-BR-001`, `F001-SEC-001`, `F001-AI-001`, `F001-INT-001`, and `F001-E2E-001`.

Current calendar policy: `NO_CALENDAR_TIMELINE_BASELINED`. Dependency order and parallel execution must not be interpreted as a date or duration commitment.

<!-- EXECUTION_OVERLAY:START -->
## Active execution overlay

The canonical product/wave authorities above remain unchanged. For live implementation continuation, the execution workflow is additionally governed by:

- `NEXT_CHAT_START_HERE.md` and `EXECUTION_PLAYBOOK.md` for the five-go -> Codex QA -> human UAT lifecycle;
- `WAVE_GO_EXECUTION_REGISTER.csv` for GO/QA/UAT progress;
- `FEATURE_EXECUTION_STATUS.csv` for per-feature implementation/QA/UAT/acceptance state;
- `DEFECT_REGISTER.csv` for reproducible implementation/QA/UAT defects;
- `EXECUTION_DASHBOARD.md` as a generated view only.

These execution overlays may not redefine canonical F-IDs, specifications, dependencies or wave scope.
<!-- EXECUTION_OVERLAY:END -->
