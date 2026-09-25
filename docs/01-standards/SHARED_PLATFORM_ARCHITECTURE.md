# Shared Platform Architecture

Status: `AUTHORITATIVE` — established by the Shared Platform rebuild (Prompt 1).
Enforced by `pnpm verify:architecture`, `pnpm verify:access` and
`pnpm test:access:db`. Structure: [PROJECT_STRUCTURE_CONSTITUTION.md](PROJECT_STRUCTURE_CONSTITUTION.md).
Tenant transactions: [TENANT_TRANSACTION_RLS_STANDARD.md](TENANT_TRANSACTION_RLS_STANDARD.md).

The model is **RBAC + contextual scope + domain record policies + field
projection + PostgreSQL RLS, enforced server-side.** The frontend is never
authoritative for security.

## 1. Layers

| Layer | Where | Owns |
|---|---|---|
| Web/BFF | `apps/web/src/app` (routes/pages), `apps/web/src/core` | HTTP transport, cookies, same-origin checks, route composition (`workspaceRoute`), request-scoped caching. No SQL, no business rules. |
| Access | `services/api/src/core/access/` → `@vercentlabs/api/access` | Principal, WorkspaceAccessSnapshot, `authorize()`, module/scope/field checks, stable error codes, denial logging/audit. |
| Auth | `services/api/src/core/auth/` | Sessions, passwords, email verification, MFA/TOTP, recovery codes, OAuth, rate-limited login. |
| Organization | `services/api/src/core/organization/` | Organizations, companies, branches, memberships, invitations, registration. |
| Billing | `services/api/src/core/billing/` | Subscriptions, plan entitlements, seats, usage limits, billing write gate. |
| Security | `services/api/src/core/security/` | Origin/CSRF, rate limits, audit writer + redaction, attachment security, API keys, privacy. |
| Platform | `services/api/src/core/platform/` | Configuration, numbering, idempotency, notifications, approvals, background jobs, tags, inbound mail, AI governance. |
| Business modules | `services/api/src/modules/<module>/` | Domain logic and **record policies** (CRM owner/team, POS store/terminal, HR self/manager, Support queue, Projects membership, Stock warehouse). |
| Orchestration | `services/api/src/orchestration/` | Cross-module workflows, through public module contracts only. |
| Canonical catalogues | `@vercentlabs/permissions`, `@vercentlabs/shared-types` | Permission keys, role templates, SoD rules, module→view-permission map; the module catalogue. |
| Database | `database/platform`, `database/tenant`, `@vercentlabs/database` | Schema, FORCE RLS, `runTenantTransaction`. |
| Worker | `services/worker` | Durable PostgreSQL-backed jobs/outbox/webhooks; same domain services, own tenant transaction per job. |
| Infrastructure | `infrastructure/` | Web + worker → managed PostgreSQL; object storage, secret manager, monitoring. No Redis/Kafka. |

The flat `services/api/src/core/*.js` files predate the domain directories;
each domain `index.js` re-exports them so callers can move to the boundary
now, and implementations move behind it incrementally. New core code is only
ever created inside a domain directory (validator-enforced).

## 2. Trust boundaries

1. **Browser → Web/BFF.** Untrusted. Identity comes only from the session
   cookie / mobile bearer token, resolved server-side by
   `resolveSessionContext`. `organizationId`, company, branch, role or
   permission claims in JSON, query strings or paths are never trusted;
   `assertNoClientTenantOverride` refuses a disagreeing claim and the
   validator rejects code that reads one.
2. **Web/BFF → domain services.** Routes pass the server-resolved session /
   principal. Route checks are necessary but **not sufficient**: domain
   functions re-check permissions and own record/state rules.
3. **Domain → PostgreSQL.** The runtime role is `NOBYPASSRLS`/`NOSUPERUSER`.
   Tenant data is reachable only inside `runTenantTransaction`; FORCE RLS on
   every tenant table is the final isolation defence even if application code
   is wrong.
4. **Worker → PostgreSQL.** Tenant from the durable job record, never a
   request; same restricted role and tenant transaction.

## 3. Authorization pipeline

```text
authentication → MFA assurance → active membership / organization
→ module released → module enabled → plan entitlement → permission
→ company scope → branch / domain scope → record policy → field policy
→ state / SoD / business rule → transaction → audit
```

- `createAccessPrincipal(session)` — the one security principal: user,
  organization, sorted role slugs, permission union, active and granted
  company/branch scope, locale/timezone, MFA assurance. No PII beyond ids.
- `buildWorkspaceAccessSnapshot(client, session)` — principal + subscription +
  per-module state (released/enabled/entitled/permitted) + accessible
  companies/branches, resolved **once per request** (React `cache()` on the
  web, per job in the worker). Never persisted: role, module and billing
  changes apply on the next request (role changes also revoke sessions).
- `authorize({ principal, snapshot, module, permission(s), action, resource,
  context, recordPolicy })` — pure decision, stable code. Shared rules only;
  modules pass their record rule as `recordPolicy` or run it afterwards.
- Field rules: `projectFields` / `assertWritableFields` with
  `{ permission, fields }` rules.

Stable codes (`ACCESS_ERROR_CODES`): `AUTH_REQUIRED` 401, `AUTH_MFA_REQUIRED`,
`MEMBERSHIP_INACTIVE`, `MODULE_UNAVAILABLE` 404, `MODULE_DISABLED`,
`MODULE_NOT_ENTITLED`, `PERMISSION_DENIED`, `SCOPE_DENIED`,
`FIELD_ACCESS_DENIED` 403, `SOD_CONFLICT` 409. A directly addressed record
outside the caller's scope is **concealed** as `RESOURCE_NOT_FOUND` 404 (the
original code stays on `deniedCode` for audit). Legacy codes
(`MODULE_NOT_PERMITTED`, `COMPANY_ACCESS_DENIED`, …) remain on existing
error classes and map through `canonicalAccessCode`.

Observability: denials log through `@vercentlabs/observability` (redacted)
with requestId, correlationId, organizationId, userId, module, action,
permission and code; `recordAccessDenial` writes durable audit evidence.
Never log passwords, session tokens, MFA secrets, API keys or OAuth secrets.

## 4. Route → domain → database

```ts
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true, action: "crm.lead_source.create" },
    async ({ client, session }) => ok({ record: await createCrmLeadSource(client, crmContext(session), await readJson(request)) }, 201),
  );
}
```

`workspaceRoute` (`apps/web/src/core/workspace-route.ts`, order proven in
`secure-route.test.ts`): same-origin check for every non-GET method → MFA-
satisfied workspace session → transaction (`tenant` default, `platform` for
public tables, `none` for single-client reads) → snapshot/principal →
`authorize` → billing write gate → handler (validation, domain call, audit).
The route-security and billing matrices audit it. Reference adoptions:
`api/settings/roles`, `api/settings/roles/permissions`,
`api/settings/users/[id]/access`, `api/crm/lead-sources`. Remaining routes use
the per-module `require<Module>Access` helpers (documented exceptions) and
migrate in later prompts.

## 5. Public/platform vs tenant data

| Public / platform schema (no RLS today) | Tenant schema (`tenant.*`, FORCE RLS) |
|---|---|
| users, sessions, login/MFA/recovery data, organizations, companies, branches, memberships, invitations, roles, role assignments, role permissions, permission metadata, module enablement, subscriptions/entitlements/seats, platform administration | CRM, Sales, Procurement, Stock, Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, Accounting and all other tenant business data |

Every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY` with the
`organization_id = tenant.current_organization_id()` policy (statically
tested). Public tables rely on explicit `organization_id` predicates in the
domain layer. **Organization-scoped RLS for public/platform tables is a later
hardening phase** that first requires classifying each table (global vs
per-organization vs authentication-critical); do not enable RLS on
authentication tables piecemeal.

## 6. Rules for new modules

- Register permissions in `@vercentlabs/permissions` (+ a platform migration
  inserting them into `permissions`); add at least one module role; add the
  module's view permission to `MODULE_ACCESS_PERMISSIONS`.
- Register the module once in `ERP_MODULE_CATALOG`; never hard-code module
  key lists elsewhere.
- Web: `apps/web/src/features/<module>/`; routes use `workspaceRoute`.
- API: `services/api/src/modules/<module>/index.js` is the only public
  contract; record policies live in the module; cross-module work goes through
  `services/api/src/orchestration`.
- Tenant tables go in `database/tenant/migrations` with FORCE RLS.
- Changing a built-in role template requires a NEW platform migration that
  reconciles existing tenants plus `pnpm access:role-lock --write
  --synchronized-by <migration>` (never edit shipped migrations).

## 7. Rules for agents / code generation (validator-enforced)

- Frontend checks are UX only; route checks are not enough; domain
  authorization is authoritative; tenant RLS is the final isolation defence.
- `organizationId` is never taken from client input — only from the session
  principal (`workspaceTransaction(principal, …)`).
- Permissions, roles, SoD rules and the module catalogue come from one
  canonical package each; no second registry, no unregistered permission
  strings.
- Modules cannot invent private auth systems or redefine session/permission
  primitives; they consume `@vercentlabs/api` / `@vercentlabs/api/access`.
- Do not duplicate Shared Platform services; extend the owning domain.
- No `apps/web/src/components|lib|modules`; no SQL or `pg` in web code outside
  `core/db.ts`; no private cross-module or cross-feature imports; no new flat
  `services/api/src/core/*.js` files; tenant context only via
  `@vercentlabs/database`.
- Exceptions are explicit, named lists with reasons in
  `scripts/validation/architecture-rules.mjs`; shrink them, never grow them
  silently.

## 8. Tests

| Suite | Location | Command |
|---|---|---|
| Access domain/unit | `services/api/tests/access/` | `pnpm verify:access` |
| Catalogue integrity + role lock | `packages/permissions/tests/` | `pnpm verify:access` |
| Route composition | `apps/web/src/core/secure-route.test.ts` | `pnpm verify:access` |
| Architecture rules | `scripts/validation/architecture-rules.test.mjs` | `pnpm verify:access` |
| Real PostgreSQL access/RLS | `tests/integration/access/` + listed isolation suites | `pnpm test:access:db` (fails on skip) |
| Adversarial tenant/security | `tests/security/` | `pnpm test:security` |
| Browser behaviour | `apps/web/e2e/` | `pnpm test:e2e:erp` |

CI: `erp-ci.yml` runs `verify:access` in the main job and a dedicated
`shared-access-db` job (PostgreSQL 16, migrations, restricted runtime role,
`test:access:db`).

## 9. Known gaps (closed in later prompts)

1. Delegated-administrator company/branch containment is not wired into every
   Settings path (e.g. `settings/users/[id]/access`).
2. Module enable/disable exists at runtime; its administration UI/API is incomplete.
3. Department/team access exists in foundations but is not universally wired.
4. Record access stays domain-specific by design; field security is uneven across modules.
5. Organization-scoped public/platform tables lack an RLS safety net (§5).
6. Access audit evidence is not uniformly written (`recordAccessDenial` exists; adoption pending).
7. Built-in role grants in older tenants may predate the role lock baseline; only CRM grants were reconciled (migration 058).
8. Some client-side action visibility is coarser than server permission granularity.
9. Most routes still use per-module `require<Module>Access` helpers instead of `workspaceRoute`.
10. `docs/frontend-rebuild/recovered-platform-code` is still read by `verify:t01` for two unported slices (reporting dataset permissions, workflow-run engine).
