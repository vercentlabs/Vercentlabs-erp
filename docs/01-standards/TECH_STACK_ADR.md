# ADR — Frozen Technical Stack for ERP Implementation

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

## Decision
Preserve and harden the current modular-monolith stack. AI implementation agents MUST reuse existing platform packages and boundaries before introducing new infrastructure.

| Layer | Frozen baseline |
|---|---|
| Runtime | Node.js 24.x (repository requirement) |
| Package manager | repository-pinned pnpm |
| Web application | Next.js 16.2.11; React 19.2.3 |
| Validation | Zod ^4.1.12 |
| Database | PostgreSQL 16-class target; `pg` ^8.16.3 |
| Web architecture | Next.js route/transport shell + domain services in `services/api` |
| Background work | existing `services/worker` durable job architecture |
| Mobile | Expo ~57.0.8; React Native 0.86.0; native app, not WebView parity |
| Mobile local data | encrypted/local SQLite where offline capability is explicitly approved |
| Shared UI | `@vercentlabs/shared-ui` + Experience Kernel |
| Permissions | `@vercentlabs/permissions` + authoritative server checks + DB RLS defense-in-depth |
| Workflows | `@vercentlabs/workflows` |
| Reporting | `@vercentlabs/reporting-engine` |
| Documents | `@vercentlabs/document-engine` |
| Localization | `@vercentlabs/localization` |
| Observability | `@vercentlabs/observability` |
| Containers | Docker |
| CI/release verification | GitHub Actions + repository verification scripts |

## Non-goals / anti-drift rules
Do not add another database, ORM, backend framework, message broker, GraphQL layer, state-management framework, job engine, permission engine or design system merely for convenience. A new architectural dependency requires an ADR proving that existing primitives cannot satisfy an approved requirement, plus migration/operations/security ownership.

Microservices are not the default. Module boundaries are logical/public-contract boundaries inside the modular monolith; extraction is a later operational decision supported by those contracts.
