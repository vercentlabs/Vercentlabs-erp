# Release, Rollout and Rollback Plan

Each release defines migrations, compatibility window, feature flags, observability, smoke/E2E gates, reconciliation probes and rollback/forward-fix steps. Prefer progressive rollout. A rollback that would lose committed business truth is prohibited; use compensating/forward-fix procedures for irreversible financial/stock/payroll events. Database rollback strategy must be migration-specific and tested.
