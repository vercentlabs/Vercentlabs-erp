# Current-Code Evidence Capture Standard

Every code claim must record: evidence ID, Git commit SHA, exact path, symbol/route/table/locator, observed behavior, confidence and verification status. A similarly named file is not proof that a requirement is implemented.

The audit inspects database constraints/RLS/migrations; backend public module contracts/commands/queries/rules/orchestration/workers; web routes/workspaces/forms; mobile/offline/sync; shared permissions/contracts/UI primitives; and relevant unit/API/integration/security/E2E tests.

Gap formula: **target requirement - verified current evidence = exact implementation gap**.
