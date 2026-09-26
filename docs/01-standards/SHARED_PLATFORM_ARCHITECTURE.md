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
| Billing | `services/api/src/core/billing/` | Vercentlabs SaaS billing (never tenant Accounting): commercial catalogue and immutable price versions, subscription state model, seats, checkout/seat/cancellation sagas, Razorpay adapter, webhook ingestion + worker processing, reconciliation, plan entitlements, business write gate. See [SAAS_BILLING_ARCHITECTURE.md](SAAS_BILLING_ARCHITECTURE.md). |
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
The route-security and billing matrices audit it. Every Shared Access
administration route (`api/settings/**`, `api/auth/invitations`, invitation
resend/revoke) uses it (validator-enforced; organisation profile/security and
self-service sessions are listed exceptions), plus `api/crm/lead-sources` as
the business-module reference. Business-module routes still use the
per-module `require<Module>Access` helpers and migrate in later prompts.
Administration routes run in `transaction: "platform"` (public tables, no
tenant RLS context) and set `auditDenial: true`: every denial is logged; for
these routes an authenticated denial is also written to `audit_events` on a
separate connection (best-effort, never turning a 403 into a 500). Routine
business denials are not persisted, so a client cannot flood the audit log.

## 5. Administration model

| Role | Administration authority |
|---|---|
| Organisation Owner | Unrestricted final authority (all permissions; unassignable; ownership moves only through the controlled transfer flow). |
| System Administrator | Unrestricted organisation-wide administration (all permissions). |
| Company Administrator | Delegated administration of companies, branches and users **only inside explicitly granted companies/branches**. Explicit allow-list: `workspace.view, notifications.view, profile.manage, company.manage, branch.manage, department.manage, cost_center.manage, team.manage, users.view, users.manage, roles.view, roles.assign`. No business-module, `organization.manage`, `roles.manage`, `modules.manage`, SoD-override, audit or billing authority. |

- **Roles compose.** Access is the union of a person's roles; a Company
  Administrator who also runs Sales additionally holds a Sales role. Nobody
  grants what they do not hold (grant ceiling); there is no assign-anything
  bypass. `listGrantableRolesForActor` tells the UI exactly what an actor may
  grant.
- **Role definitions are organisation-global** (`roles.manage`: Owner/System
  Administrator). Built-in roles are read-only and reconciled for every tenant
  by generated canonical sync migrations
  (`scripts/database/generate-canonical-role-sync-migration.mjs`; the role lock
  points at the latest one).
- **Module enablement is organisation-global** (`modules.manage`, Settings >
  Modules). It is independent of the plan: enabled + not entitled, or entitled
  + disabled, are both unavailable. Disabling deletes nothing.
- **Company and branch access are per-user security grants.** The active
  company/branch is only context for the session, never authorization. A
  delegated administrator only lists and changes users, invitations, companies
  and branches entirely inside their own grants (one SQL predicate,
  `memberWithinAdministrationScopeSql` / `invitationWithinAdministrationScopeSql`,
  used for listing and every mutation); out-of-scope ids answer "not found" or
  403. Creating a new company needs `organization.manage`; a branch created by
  a delegated administrator is granted to them in the same transaction.
  Department/team grants remain foundations (preserved, not yet productized).
- **One user scope mutation**: `setUserAccessScope` (target-in-scope check,
  scope grant ceiling, branch-under-company validation, diff apply, evidence,
  audit). Status and role changes are scoped the same way.
- **Invitations mirror user access** in the normalized tables
  (`organization_invitation_roles` with exactly one primary role,
  `organization_invitation_company_access`, `_branch_access`); migration 060
  backfilled the legacy `role_id/company_ids/branch_ids` columns, which remain
  only as deprecated rollout mirrors. Acceptance re-validates roles and applies
  membership, every role, the primary role and scope atomically.
- **Evidence**: roles changed, scope changed, member enabled/disabled and
  invitation accepted are written to the immutable `access_assignment_events`
  in the same transaction; organisation-level changes (modules, role
  definitions) go to `audit_events`.

## 6. Public/platform vs tenant data

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

## 7. Rules for new modules

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
- Changing a built-in role template: run
  `node scripts/database/generate-canonical-role-sync-migration.mjs --write`
  (a NEW migration reconciling every tenant), then
  `pnpm access:role-lock --write --synchronized-by <that migration>`. Never
  edit a shipped migration.

## 8. Rules for agents / code generation (validator-enforced)

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
- Company Administrator stays an explicit allow-list; each access-state table
  (module enablement, user scope, invitations) has one canonical writer;
  invitations are always written through the normalized tables; Shared Access
  administration routes use `workspaceRoute()`.
- Exceptions are explicit, named lists with reasons in
  `scripts/validation/architecture-rules.mjs`; shrink them, never grow them
  silently.

## 9. Tests

| Suite | Location | Command |
|---|---|---|
| Access domain/unit | `services/api/tests/access/` | `pnpm verify:access` |
| Catalogue integrity + role lock | `packages/permissions/tests/` | `pnpm verify:access` |
| Route composition | `apps/web/src/core/secure-route.test.ts` | `pnpm verify:access` |
| Architecture rules | `scripts/validation/architecture-rules.test.mjs` | `pnpm verify:access` |
| Real PostgreSQL access/RLS, delegated admin matrix, invitations, modules, role sync | `tests/integration/access/` + listed isolation suites | `pnpm test:access:db` (fails on skip) |
| Settings access UX | `apps/web/e2e/settings-shared-access.spec.ts` | `pnpm --filter @vercentlabs/web exec playwright test settings-shared-access.spec.ts` |
| SaaS billing rules, provider isolation, worker wiring | `scripts/validation/verify-billing-architecture.mjs`, `services/api/tests/billing/` | `pnpm verify:billing` |
| Real PostgreSQL billing sagas, webhooks, leasing, recovery, entitlements | `tests/integration/billing/` (local Razorpay stand-in) | `pnpm test:billing:db` (fails on skip) |
| Shared Runtime ownership rules + unit tests | `scripts/validation/verify-shared-runtime.mjs`, `services/api/tests/shared-runtime/` | `pnpm verify:shared-runtime` |
| Real PostgreSQL notifications, approvals (Accounting/Sales/POS), audit, search, jobs | `tests/integration/shared-runtime/` | `pnpm test:shared-runtime:db` (fails on skip) |
| Shared Runtime browser journeys | `apps/web/e2e/shared-runtime.spec.ts` | `pnpm test:e2e:shared-runtime` (own server) |
| Billing browser journeys | `apps/web/e2e/billing-saas.spec.ts`, `billing-expired-subscription.spec.ts` | `pnpm test:e2e:billing` (own server + stand-in) |
| Adversarial tenant/security | `tests/security/` | `pnpm test:security` |
| Browser behaviour | `apps/web/e2e/` | `pnpm test:e2e:erp` |

CI: `erp-ci.yml` runs `verify:access`, `verify:billing` and `verify:shared-runtime`
in the main job and a dedicated `shared-access-db` job (PostgreSQL 16, migrations,
restricted runtime role, `test:access:db`, `test:billing:db`, `test:shared-runtime:db`).

## 10. Shared Runtime

Five cross-module runtime capabilities are Shared Platform services. Each has
one authoritative implementation; modules call it and never keep a second copy.

| Capability | Platform owns (`services/api/src/core/platform/`) | Orchestration connects (`services/api/src/orchestration/`) | Modules own |
|---|---|---|---|
| Notifications | `notifications/`: `createNotification` (the only writer), category registry, preferences, list/unread/mark-read, read-time projection | `notifications/visibility.js`: record-visibility adapters (CRM) | when to notify and the text |
| Approvals | `approvals/`: command catalogue, `createApprovalRequest` (one pending request per target), `finalizeApprovalRequest`, `recordApprovalDecision`, decision evidence, SoD, cancellation, viewer visibility | `approvals/registry.js` (command → module function) and `inbox.js` (validate → dispatch → finalize, one transaction) | the business decision and document state |
| Audit | `audit/reader.js`: read model over the append-only `audit_events` | — | what to audit (written through `core/security.js`) |
| Search | — | `search/providers.js` (the one provider registry) and `service.js` | the list functions the providers reuse |
| Background jobs | `jobs/`: presentation registry, viewer service | — | job handlers (`services/worker`) |

**Notifications.** In-app is the only delivered channel: there are no push or
email settings, and security email (verification, password reset, MFA) is
not governed by notification preferences. A category must be registered in
`notifications/categories.js` before anything can send it. Each row stores its
category, module and record; what is *shown* is projected at read time
against the viewer's current access. If the module is no longer accessible,
or the module's adapter says the record is not, the item becomes a neutral
stub (no text, no link). It is never dropped, so the unread badge and the
list always agree. Routes are never billing-gated.

**Approvals.** Oversight (`approvals.manage`) means seeing and cancelling, not
business authority: approving or rejecting always needs the command's own
business permission and module access, and the requester can never decide
their own request. A decision made on the module's own screen closes the
shared request in the same transaction (Accounting invoices, bills, payments,
journals and budgets; Sales quotations, orders and amendments; POS discounts
and payment overrides). A decision made in the inbox dispatches to the module
through the registry, and the platform then records it idempotently. If the
business transition fails, the whole transaction rolls back and the request
stays pending. A command without a registered handler fails closed. The
inbox shows labels and names, never raw keys or ids, and links only to modules
the viewer can open.

**Audit.** Read-only (no edit/delete API; the table rejects updates),
organisation-scoped, `audit.view` required. Keyset pagination on
`(created_at, id)` stays stable when timestamps collide. Payloads are redacted
again on read and size-capped. The UI maps event types through one label
table; unknown events render as "System activity".

**Search.** `GET /api/search` runs only the providers whose module is
released, enabled and entitled for the organisation and whose permission the
caller holds (from the request's WorkspaceAccessSnapshot). Each provider
reuses the module's own list function, so company/branch scope, record
ownership and field rules still apply. **Search never bypasses
authorization.** Results are a small DTO (title, detail, link). Queries are
2–100 characters with wildcards neutralised, and results are capped per
source and in total. Each provider runs in its own savepoint, so one failure
shows that source as unavailable without breaking the rest. The browser holds
no record providers.

**Background jobs.** Users see their own user-started jobs; `automation.view`
holders see the organisation, including scheduler work. Payloads are never
returned; progress and results are reduced to counters. Users get a curated
failure message and operations viewers get a redacted one. There is
deliberately no cancel/retry, because not every handler can stop its side
effects safely.

Enforced by `pnpm verify:shared-runtime`: one writer per table, the platform
never imports modules, the catalogue matches the registry, every worker job
type is presented, routes use `workspaceRoute`, and audit and job routes are
read-only.

## 11. Known gaps (closed in later prompts)

1. Department/team access exists in foundations but is not productized or universally wired (needs the HR/organisation-structure ownership decision).
2. Record access stays domain-specific by design; field security is uneven across modules.
3. Organization-scoped public/platform tables lack an RLS safety net (§6).
4. Business-module routes still use per-module `require<Module>Access` helpers instead of `workspaceRoute`; organisation profile/security settings routes are listed exceptions.
5. Deprecated invitation columns (`role_id`, `company_ids`, `branch_ids`) are still mirrored for the rollout window; drop them once no older instance can run.
6. `docs/frontend-rebuild/recovered-platform-code` is still read by `verify:t01` for two unported slices (reporting dataset permissions, workflow-run engine).
7. Billing: Vercentlabs GST tax invoices are not generated (provider invoices/receipts only; fails closed until the legal configuration exists); Custom contracts are provisioned by an operator script, with no internal admin UI yet; moving legacy v1 Standard subscriptions (3 included users) to v2 terms needs a deliberate provider plan change.
8. Shared Runtime: notification categories are registered only where a module emits today (CRM); search covers CRM (leads, accounts, contacts, opportunities) and Sales (customers, products) only; background jobs have no cancel/retry; notifications are in-app only (no push/email delivery).
