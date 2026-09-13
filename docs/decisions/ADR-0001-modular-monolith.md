# ADR-0001: Modular monolith, not microservices

## Status

Accepted.

## Context

Vercentlabs ERP will eventually implement 12 business modules and 510
canonical features. A microservice split per module would multiply
deployment, transaction-consistency and cross-cutting-concern (auth, audit,
tenancy) complexity long before there is a scaling reason to justify it.

## Decision

Build a single modular monolith: one `apps/api` process, one `apps/worker`
process, one `apps/web` process, backed by one PostgreSQL deployment. Module
boundaries are enforced in code (package structure + `tests/architecture`),
not by network calls between services. Business modules (in later prompts)
and the 36 shared-platform capabilities (`platform/*`) each get their own
package, but all run in-process within `apps/api`/`apps/worker`.

Cross-module interaction uses public commands, queries and events - never
direct writes to another module's private tables (root governance rule 8),
and domain events go through a transactional outbox (SP015, root governance
rule 9), so the modules remain separable later if a real scaling need
justifies extraction.

## Consequences

- Simpler local development and deployment (one API process, one worker,
  one web app, one database) - see
  [docs/operations/local-development.md](../operations/local-development.md).
- Module boundaries must be enforced mechanically, since there is no network
  boundary to fall back on. `tests/architecture` does this from day one, per
  [module-boundaries.md](../architecture/module-boundaries.md).
- A future extraction to services remains possible because the outbox and
  public-interface discipline already exist, but it is explicitly not
  being built now.
