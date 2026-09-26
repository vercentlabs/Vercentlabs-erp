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
satisfied workspace session → ONE transaction under the session's
organisation context (tenant and organisation-scoped platform tables are both
RLS-protected) → snapshot/principal → `authorize` (module → permission(s),
or `selfService` for own-records HR/Support portals, which waives only the
module view permission) → billing write gate → handler (validation, domain
call, audit) with the request/correlation ids and organisation in the log
context.

Every authenticated business and administration route uses it — directly or
through a module route helper (`features/<module>/shared/route-helpers.ts`,
audited at scan time to call `workspaceRoute` and, for mutations, set
`billingWrite`). There are no per-module access helpers and no web SQL:
record lookups live in `@vercentlabs/api`. The non-workspace routes are
explicit classes in `scripts/qa/generate-route-security-matrix.mjs`
(PUBLIC_AUTH, PUBLIC_TOKEN, WEBHOOK, SELF_SERVICE, API_KEY, PROBE,
TEST_SUPPORT); `pnpm verify:access` fails on any UNKNOWN handler, and the
billing mutation inventory covers all twelve business modules.
Administration routes set `auditDenial: true`: every denial is logged; for
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

| Public / platform schema | Tenant schema (`tenant.*`, FORCE RLS) |
|---|---|
| users, sessions, login/MFA/recovery data, organizations, companies, branches, memberships, invitations, roles, role assignments, role permissions, permission metadata, module enablement, subscriptions/entitlements/seats, platform services (files, API keys, OAuth, inbound mail, workflows, reports, …) | CRM, Sales, Procurement, Stock, Manufacturing, Projects, Assets, POS, Quality, Support, HR & Payroll, Accounting and all other tenant business data |

Every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY` with the
`organization_id = tenant.current_organization_id()` policy.

Every public table has exactly one class in
`packages/database/src/table-classification.js` (the provisioner and
`verify:production` refuse unclassified tables): ORGANIZATION_SCOPED /
ORGANIZATION_CHILD tables have forced RLS keyed on
`public.current_organization_id()` (migration 068); AUTH_IDENTITY tables are
reached through the user context or narrow SECURITY DEFINER functions;
GLOBAL_CATALOGUE tables are read-only reference data; PROVIDER_INGRESS
(billing webhooks) stores only what must exist before an organisation is
known. Runtime roles get exactly the classified privileges, no default
privileges and EXECUTE only on registered definer functions. Three database
authorities: web (`DATABASE_URL`), worker (`WORKER_DATABASE_URL`),
migration (`MIGRATION_DATABASE_URL`, jobs only). The worker lists
organisation ids from the directory (an explicitly classified global read)
and processes each organisation in its own organisation-context transaction.

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

## 11. Shared Platform services

The product layer every module builds on. Each service has one implementation
under `services/api/src/core/platform/<service>/` (plus orchestration where it
must reach modules) and a Settings page. None of them imports a module.

| Service | Platform owns | Orchestration / modules | Settings / UI |
|---|---|---|---|
| Numbering | `numbering/`: `DOCUMENT_TYPES` registry, `nextDocumentNumber` (single-statement allocator), policies, forward-only advance | modules call `nextDocumentNumber`; nothing else writes a counter | Settings > Numbering |
| Files | `files/`: prepare (validate + scan) → store → list/versions/read/archive; expiry purge | CRM and Support attachments, export artifacts, report output, inbound mail attachments | per-record panels |
| Developer API | `integrations/api-keys/`: developer apps, keys, the scope catalogue | `/api/v1/*` via `apiKeyRoute` | Integrations > Developer API |
| OAuth | `integrations/oauth/`: registered profiles, Authorization Code + PKCE, encrypted credentials, refresh with rotation | — | Integrations > Connected accounts |
| Events + webhooks | `events/` (registry, `publishDomainEvent`, dispatch) and `integrations/webhooks/` (subscriptions, per-delivery state, signing, SSRF-safe transport) | `integrations/event-fan-out.js` wires webhooks + workflows | Integrations > Webhooks |
| Inbound mail | `integrations/inbound-mail/`: routes, signature check, normalisation, idempotent event record | `integrations/inbound-mail.js`: Support email-to-ticket | Integrations > Inbound email |
| Mail | `mail/transport.js`: the one SMTP transport | auth and notification mail | — |
| Data exchange | `data-exchange/csv.js`: server-side CSV parsing with caps | `data-exchange/registry.js`: CRM lead import/export | CRM import/export |
| Documents | `packages/document-engine` (`pdf.js`, object storage contract) | `documents/registry.js`: POS receipt, Sales quotation, Sales order renderers | "Download PDF" buttons |
| Configuration | `configuration/`: registry of typed keys and flags, effective-dated versions | consumers read through `getConfigurationValue` / `isFeatureFlagEnabled` | Settings > Feature configuration |
| Privacy | `privacy/`: request tracker, versioned retention policies for registered data classes | CRM keeps its own subject-aware data requests | Settings > Privacy and retention |
| AI governance | `ai/`: tool registry (empty today), versioned organisation policy, fail-closed checks | — | Settings > AI governance |
| Workflows | `workflows/`: registered triggers, fixed condition vocabulary, registered actions (in-app notification), versioned definitions, runs | fan-out from domain events; the worker executes runs | Settings > Automations |
| Reporting | `reporting/execution-context.js` | `reporting/datasets.js` + `service.js`: permissioned datasets, background runs, expiring CSV output | Reports |

### Webhook signing contract (v1)

Each delivery is an HTTP POST of a JSON envelope `{ id, type, version,
occurredAt, module, entity: { type, id }, data }`, where `data` is the event's registered
projection (no contact details). Headers:

- `X-Vercentlabs-Event`: the event type, for example `crm.leads.assigned`.
- `X-Vercentlabs-Event-Id`: stable per event.
- `X-Vercentlabs-Delivery-Id`: stable per (event, subscription), and the same on every retry.
- `X-Vercentlabs-Timestamp`: unix seconds when this attempt was signed.
- `X-Vercentlabs-Signature`: `v1=<hex HMAC-SHA256(secret, "<delivery-id>.<timestamp>.<raw body>")>`.

A webhook receives only events that occur after it was created. Receivers
verify in constant time, reject stale timestamps, and de-duplicate on the
event id, because delivery is at least once. Retries use exponential
backoff with jitter, honour `Retry-After`, and stop after the configured
number of attempts (`platform.webhooks.max_delivery_attempts`, 3–10, default
8). After that the delivery is marked failed and can be resent from Settings.
Endpoints must be public: private, loopback and link-local targets are refused
at save time and again at send time, including after DNS resolution and on
redirects. The operator flag `operator.webhooks.delivery_paused` holds
deliveries in the queue without losing them. Signing secrets are encrypted at
rest and shown once, on create and on rotate.

### Inbound email provider contract

`POST /api/platform/mail/inbound/{routeKey}` is public: there is no session,
and the route key identifies the organisation's inbound address.

- **Authentication:** the `X-Inbound-Signature` header carries the hex
  HMAC-SHA256 of the raw request body, keyed with the route's signing secret,
  optionally prefixed with `sha256=`.
- **Body:** JSON `{ provider, messageId, from, fromName?, to, subject, text,
  inReplyTo?, references?, attachments?: [{ fileName, contentType,
  contentBase64 }] }`.
- **Idempotency:** receipt is idempotent per (organisation, provider,
  messageId). A replay returns the first outcome. The same id with different
  content is refused.
- **Threading:** a message joins an existing ticket by its message
  references, then by the `[TKT-…]` subject token. Otherwise it opens a new
  ticket; so does a reply to a closed ticket.
- **Access checks:** the Support module, entitlement and billing state are
  checked before anything is written.
- **Attachments:** each one is validated and scanned. A rejected attachment
  is noted on the event and does not stop the message.

The route key and signing secret are shown once, when the address is created.

### Developer API (`/api/v1`) contract

- **Authentication:** `Authorization: Bearer <key>` only. There is no cookie
  session and no CSRF.
- **Organisation:** always taken from the key, never from the request.
- **Scopes:** a key holds explicit scopes from `API_SCOPES` and never `*`. A
  scope exists only when a v1 endpoint consumes it (today:
  `platform.context.read`). A key is not a user and carries no user roles or
  permissions.
- **Success response:** `{ ok: true, requestId, ...data }`.
- **Error response:** `{ ok: false, code, message, requestId }`, with the
  `X-Request-Id` header:

  | Status | Code | Meaning |
  |---|---|---|
  | 400 | `VALIDATION_FAILED` | the request is not valid |
  | 401 | `PLATFORM_API_KEY_REQUIRED` / `PLATFORM_API_KEY_INVALID` | missing, unknown, revoked or expired key |
  | 403 | `PLATFORM_API_SCOPE_DENIED` | the key lacks the endpoint's scope |
  | 404 | `*_NOT_FOUND` | no such resource for this organisation |
  | 413 | `REQUEST_TOO_LARGE` | the body is over the endpoint limit |
  | 429 | `RATE_LIMITED` | over the per-key limit (`API_KEY_RATE_LIMIT_PER_MINUTE`, default 600); see `Retry-After` |
  | 500 | `INTERNAL_ERROR` | anything unexpected; no internals in the message |

- **Tokens:** stored only as hashes and shown once. Last use is recorded at
  most every five minutes.

### Numbering migration rules

`tenant.document_numbering_policies` (prefix, padding, reset policy, version)
and `document_sequences` (counters) replace `numbering_series` and the
per-module fallbacks. Migration 181 carries each legacy series forward as an
organisation-level policy and counter, so families that were unique per
organisation stay that way. The counter floor is the greater of the legacy
`next_number` and the highest number already issued, parsed from existing
documents plus one, so no issued number can repeat. Procurement's fallback
counters were merged the same way. Newer families are numbered per company.

- Changing a prefix, padding or reset policy creates a new policy version and
  applies only to documents created afterwards; issued numbers never change.
- Counters can only move forward.
- Families with their own module settings (project tasks, POS shifts) are
  listed but not editable here.
- `nextDocumentNumber` is the only allocator (`verify:platform-services`).

### Files and object storage

- **Storage:** new file content lives in object storage (`storage_mode =
  object`, no bytes in PostgreSQL). Legacy `bytea` rows stay readable
  (`database_legacy`).
- **Access:** keys are internal and opaque, and never accepted from a request.
  Every read goes through the owning module's authorisation. Only clean
  (scanned) files are served.
- **Versions and archiving:** a new version keeps the logical id. Removing a
  file archives it; nothing is hard-deleted from a request.
- **Expiring files:** export artifacts and report output carry an
  `expires_at` (`platform.exports.artifact_retention_hours`). Once expired, a
  read returns 410, and the maintenance loop purges the content and keeps the
  metadata.
- **Drivers:** `FILE_STORAGE_DRIVER=gcs` (production; private bucket through
  Workload Identity, SHA-256 metadata, optional `FILE_STORAGE_GCS_API_ENDPOINT`),
  `local` (the development default) or `memory` (single-process tests).
  Production refuses local/memory and has no default. Legacy bytes move with
  `pnpm files:migrate-legacy`; `pnpm files:reconcile` checks metadata against
  the bucket.

Enforced by `pnpm verify:platform-services` (static rules and unit tests) and
`pnpm test:platform-services:db` (real PostgreSQL, zero skips allowed). Browser
journeys: `pnpm test:e2e:platform-services`, which runs its own web server and
the OAuth stand-in.

## 12. Known gaps (closed in later prompts)

1. Department/team access exists in foundations but is not productized or universally wired (needs the HR/organisation-structure ownership decision).
2. Record access stays domain-specific by design; field security is uneven across modules.
3. Organization-scoped public/platform tables lack an RLS safety net (§6).
4. Business-module routes still use per-module `require<Module>Access` helpers instead of `workspaceRoute`; organisation profile/security settings routes are listed exceptions.
5. Deprecated invitation columns (`role_id`, `company_ids`, `branch_ids`) are still mirrored for the rollout window; drop them once no older instance can run.
6. Billing: Vercentlabs GST tax invoices are not generated (provider invoices/receipts only; fails closed until the legal configuration exists); Custom contracts are provisioned by an operator script, with no internal admin UI yet; moving legacy v1 Standard subscriptions (3 included users) to v2 terms needs a deliberate provider plan change.
7. Shared Runtime: notification categories are registered only where a module emits today (CRM); search covers CRM (leads, accounts, contacts, opportunities) and Sales (customers, products) only; background jobs have no cancel/retry; notifications are in-app only (no push/email delivery).
8. Platform services (Prompt 6): organisation-scoped platform tables (`attachments`, `api_keys`, `oauth_connections`, `inbound_mail_*`, workflow and report tables) still lack RLS; integration secrets use one environment key with no KMS or rotation tooling; a cloud object-storage provider is not implemented (production file storage fails closed); retired tables (`numbering_series`, `crm_webhook_subscriptions`, `crm_outbox_events`) are commented as retired but not dropped.
9. Platform services scope: the only v1 endpoint is `GET /api/v1/platform/context`; workflows have one action (in-app notification) and CRM triggers only; report datasets are CRM leads and Sales orders, without scheduling; no AI tools are registered; tags have no Settings admin page.
