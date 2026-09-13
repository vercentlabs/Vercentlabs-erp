# Vercentlabs ERP - Root Governance

These instructions are permanent and apply to every contributor, human or AI,
working anywhere in this repository. They override convenience, speed, or the
desire to make a check pass. When a task conflicts with a rule below, stop and
raise the conflict instead of silently resolving it in favor of the task.

1. Live code, database migrations, executable tests and runtime evidence are
   authoritative. Nothing else establishes what is actually built.
2. Documentation alone is not proof of implementation.
3. A screen or route alone is not a completed feature.
4. All business writes require server-side authorization and validation.
   Client-side checks are UX only.
5. Preserve organization, company, branch, team, owner, record and field
   access boundaries in every code path that touches business data.
6. Tenant context must come from trusted authenticated server state, never
   directly from a client-supplied organization ID.
7. Important mutations must use transactions, idempotency and audit evidence.
8. Cross-module private database writes are prohibited. Modules interact
   through public commands, queries and events only.
9. Domain events must use a transactional outbox.
10. Workers must use persisted tenant and authorization context, never
    ambient or inferred context.
11. Money must use PostgreSQL `numeric` and API decimal strings, never
    JavaScript floating-point arithmetic.
12. JavaScript `BigInt` must never be serialized directly as JSON.
13. Do not weaken or delete tests to make verification pass.
14. Do not use mock data in production paths.
15. Do not mark any SP or F identifier complete without acceptance evidence.
16. Every implementation must cover success, empty, validation, forbidden,
    conflict, retry and recovery behavior where applicable.
17. Accessibility and responsive behavior are mandatory, not optional polish.
18. Secrets must never be committed or logged.
19. All dependencies must be pinned and reviewed. No `latest` or unbounded
    ranges.
20. Stop when the authorized prompt scope is complete. Do not improvise
    scope beyond what was authorized.

## How this repository is organized

- `apps/` - deployable applications (`web`, `api`, `worker`).
- `packages/` - shared libraries consumed by apps and platform modules.
- `platform/` - shared-platform capability modules (SP001-SP036). These are
  cross-cutting engineering concerns, not business modules.
- `product/` - the product register, requirements, acceptance criteria and
  evidence that back every status claim.
- `database/` - reviewed SQL migrations and seed/fixture data, split into
  `platform` and `tenant` scopes.
- `tests/` - architecture, contract, integration, security, performance and
  end-to-end journey tests.
- `docs/` - architecture references, ADRs, operations and security docs.

See [`product/registers/shared-platform.yaml`](product/registers/shared-platform.yaml)
for the authoritative status of every shared-platform capability. See
[`docs/decisions/ADR-0004-evidence-based-feature-status.md`](docs/decisions/ADR-0004-evidence-based-feature-status.md)
for why the register cannot self-certify implementation status.
