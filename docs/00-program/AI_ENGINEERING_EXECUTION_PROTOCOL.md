# AI Engineering Execution Protocol

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

This document governs ChatGPT/Codex/AI-agent implementation of Vercentlabs ERP.

## Mandatory loop for every capability pack
1. **Load authority** — canonical F-IDs, approved dossiers/subrequirements, capability/dependency/journey registers, architecture standards, Experience Kernel, existing tests and current source.
2. **Audit repository first** — locate existing tables/migrations, services, routes, UI, mobile adapters, worker handlers, tests and public contracts. Reuse before adding.
3. **Emit implementation manifest** — list exact requirements, dependencies, files/areas, DB changes, commands/queries/events, web/mobile surfaces, tests, rollout/rollback and open blockers.
4. **Database/invariants first where stateful** — migrations, constraints, RLS, indexes, deterministic calculations and DB/security tests.
5. **Domain backend** — public commands/queries, permission/scope enforcement, state machines, concurrency, idempotency, audit/outbox, reversal/reconciliation.
6. **Transport** — thin versioned route/API adapters.
7. **Web UX** — approved Experience Kernel components, complete loading/empty/error/permission/conflict/pending states, responsive/accessibility behavior.
8. **Mobile/offline** — only when the feature's classification requires it; same server truth and permissions.
9. **Cross-module integration** — public contracts/orchestration only; verify happy/failure/retry/reversal/reconciliation.
10. **Automated verification** — domain/property, DB/RLS, permission-negative, API, integration, concurrency/fault, reconciliation, migration, performance, E2E and accessibility as applicable.
11. **Visual verification** — representative desktop/tablet/mobile states for major surfaces.
12. **Adversarial review** — attempt tenant escape, permission bypass, duplicate submit, races, stale state, provider uncertainty, reversal failure and data leakage.
13. **Repository gates** — run the smallest complete deterministic verification set for the changed capability and the release gate required by the wave.
14. **Evidence packet** — requirements satisfied, files changed, migrations, test IDs/results, screenshots where required, risks/limitations, rollback/reconciliation notes.
15. **Coherent checkpoint** — commit only the capability pack when gates pass; never mark Product Ready from code existence alone.

## Stop conditions
AI stops implementation and reports a planning blocker when requirements conflict, an authoritative system-of-record is unclear, a deterministic calculation lacks an approved rule, a cross-module ownership violation would be necessary, a migration cannot be made safely, or security/tenant isolation cannot be objectively tested.

## Completion formula
`approved requirement + authoritative data/state behavior + server authorization + correct UI + automated evidence + integration/reconciliation + E2E/UAT = readiness`. A route, table, button or test stub alone never satisfies a feature.
