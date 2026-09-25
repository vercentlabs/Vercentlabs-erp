# Project Structure Constitution

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE` (revised for the Shared Platform
rebuild, Prompt 1). Enforced by `pnpm verify:architecture` and
`pnpm verify:access` — see `scripts/validation/architecture-rules.mjs`.
The platform/security architecture itself is described in
[SHARED_PLATFORM_ARCHITECTURE.md](SHARED_PLATFORM_ARCHITECTURE.md).

```text
apps/web/src/app/                   # Next.js routing + thin transport composition only (pages, route handlers)
apps/web/src/core/                  # protected web runtime: session, db (tenant transactions), http, workspace-route, access snapshot
apps/web/src/features/<module>/     # product capabilities and business modules (crm, sales, accounting, …)
apps/web/src/features/settings/     # tenant administration / Shared Platform administrative UX
apps/web/src/shell/                 # workspace shell: navigation, sidebars, workspace context
apps/web/src/shared/                # genuinely generic frontend utilities and reusable UI adapters
apps/mobile/src/                    # route composition, core providers, module screens, shared native UI
services/api/src/core/<domain>/     # Shared Platform domains: access, auth, organization, billing, platform, security
services/api/src/modules/<module>/  # the 12 business modules: public contract (index.js) + private domain logic
services/api/src/orchestration/     # cross-module workflow coordinators
services/worker/                    # durable PostgreSQL-backed jobs/outbox
packages/                           # reusable platform libraries only (permissions, shared-types, database, observability, …)
database/platform/                  # public/platform schema migrations
database/tenant/                    # tenant business-data migrations (FORCE RLS)
services/api/tests/                 # domain/unit tests (services/api/tests/access/ for Shared Access)
tests/integration/                  # real-PostgreSQL integration tests (tests/integration/access/ for Shared Access)
tests/security/                     # adversarial tenant/RBAC/IDOR/security-negative tests
apps/web/e2e/                       # Playwright browser behaviour
scripts/validation/                 # deterministic architecture/release verification
docs/                               # source of truth / traceability
```

`apps/web/src` contains exactly `app`, `core`, `features`, `shell` and
`shared`. `components/`, `lib/`, `modules/`, `server/`, `platform/` and
`orchestration/` directories (or `@/…` aliases to them) are rejected.

## Ownership
- F-IDs are documentation/traceability anchors, never source-code directories.
- Each business module owns its private data model and domain decisions.
- Another module may interact only through a public module command/query/event contract (its `index.js`, or a feature's public `index.ts` on the web).
- Multi-module business coordination belongs in `services/api/src/orchestration`.
- Route handlers are thin transport adapters; they do not become a second domain layer, and they do not issue SQL.
- New Shared Platform server code goes inside a `services/api/src/core/<domain>/` boundary, never as a new flat `core/*.js` file.
- Shared packages may contain genuinely cross-module primitives, never module-specific shortcuts disguised as shared code.
- Mobile and web consume the same server-side business truth and permission model.
