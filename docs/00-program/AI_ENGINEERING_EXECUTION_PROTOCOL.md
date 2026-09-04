# AI Engineering Execution Protocol

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

This document governs ChatGPT/Codex/AI-agent implementation of Vercentlabs ERP.

## Step 0 — Acquire registered work package

Before any implementation edit, an AI agent must:

1. know its exact `AWP-ID`;
2. load the matching row from `AGENT_WORK_PACKAGE_REGISTER.csv`;
3. verify the canonical wave;
4. verify canonical predecessor gates;
5. verify package dependencies;
6. verify the registered base commit is valid/ancestral;
7. verify the current branch/worktree matches the registered branch;
8. verify exact owned and forbidden paths;
9. verify migration reservations before creating SQL;
10. verify shared/global change restrictions;
11. run the parallel-governance and per-agent scope validators.

No unregistered implementation scope is authorized.

## Mandatory loop for every capability package
1. **Load authority** — canonical F-IDs, approved dossiers/subrequirements, capability/dependency/journey registers, architecture standards, Experience Kernel, existing tests and current source.
2. **Audit repository first** — locate existing tables/migrations, services, routes, UI, mobile adapters, worker handlers, tests and public contracts. Reuse before adding.
3. **Emit implementation manifest** — list exact requirements, dependencies, owned files/areas, DB changes, commands/queries/events, web/mobile surfaces, tests, rollout/rollback and open blockers.
4. **Database/invariants first where stateful** — migrations, constraints, RLS, indexes, deterministic calculations and DB/security tests. Create migrations only from a valid reservation.
5. **Domain backend** — public commands/queries, permission/scope enforcement, state machines, concurrency, idempotency, audit/outbox, reversal/reconciliation.
6. **Transport** — thin versioned route/API adapters.
7. **Web UX** — approved Experience Kernel components, complete loading/empty/error/permission/conflict/pending states, responsive/accessibility behavior.
8. **Mobile/offline** — only when the feature's classification requires it; same server truth and permissions.
9. **Cross-module integration** — public contracts/orchestration only; verify happy/failure/retry/reversal/reconciliation.
10. **Automated verification** — domain/property, DB/RLS, permission-negative, API, integration, concurrency/fault, reconciliation, migration, performance, E2E and accessibility as applicable.
11. **Visual verification** — representative desktop/tablet/mobile states for major surfaces.
12. **Adversarial review** — attempt tenant escape, permission bypass, duplicate submit, races, stale state, provider uncertainty, reversal failure and data leakage.
13. **Repository gates** — run the smallest complete deterministic verification set for the package and the release gate required by its canonical wave.
14. **Evidence packet** — requirements satisfied, files changed, migration reservations, test IDs/results, screenshots where required, risks/limitations, rollback/reconciliation notes.
15. **Ready for integration** — stop edits, mark `READY_FOR_INTEGRATION`, pass scope validation, then let PM/integration serialize integration and rerun gates against current main.

## Stop conditions
AI stops implementation and reports a governance/planning blocker when any of these occur:

- no registered AWP or scope is outside the AWP;
- canonical predecessor or package dependency is not satisfied;
- owned paths overlap another active package;
- current branch is stale/unrecognized or base commit is invalid;
- a required migration has no valid reservation;
- an ordinary feature package would need to modify central governance/shared-global files;
- requirements conflict or authoritative system-of-record is unclear;
- a deterministic calculation lacks an approved rule;
- a cross-module ownership violation would be necessary;
- a migration cannot be made safely;
- security/tenant isolation cannot be objectively tested.

## Completion formula
`approved requirement + authoritative data/state behavior + server authorization + correct UI + automated evidence + integration/reconciliation + E2E/UAT = readiness`.

A route, table, button, test stub, closed AWP or merged change alone never satisfies a feature, wave or product-readiness gate.
