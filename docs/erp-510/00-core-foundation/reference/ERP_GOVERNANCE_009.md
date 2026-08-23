# ERP Governance Foundation — Prompt 9

Billing, Audit Logs, and a new Compliance workspace (Retention, Consent, Privacy Requests, Data Governance).

## 1. Executive Summary

Prompt 9 completes the Governance navigation group Prompt 6 left with a documented gap ("Compliance — no real route exists today"). Three research agents audited the current Billing, Audit Logs, and compliance-adjacent architecture before any code was written. The findings reshaped scope substantially versus a naive reading of the spec: Billing and the audit trail are both mature, real, well-tested systems that needed **view-layer strengthening, not rebuilding** (a Usage section and a plan module-entitlement grid for Billing; four real sub-views plus a redacted, bounded export for Audit Logs). Compliance is entirely new navigation, but its underlying data model is **not** — CRM already has a complete, working privacy/retention/consent system (`crm_privacy_requests`, `crm_privacy_retention_policies`, `crm_consent_events`, an immutable evidence log) that was simply invisible outside CRM's own sidebar. The new `/compliance` workspace honestly surfaces that existing system under a shared-platform lens rather than fabricating a parallel one, and is explicit in its own copy that retention/consent/privacy-request scope today is CRM customer data (leads/contacts/parties), not every module.

One new permission (`compliance.view`) and one new control-plane migration (030) were required; no new tenant-schema tables were needed.

## 2. Previous Governance State

Per `ERP_WEB_AUDIT_001.md` and `ERP_NAVIGATION_FOUNDATION_006.md`: Billing was rated "Implemented, deep, real Razorpay" (checkout/verify/cancel/webhook routes, an explicit billing state machine, webhook-recovery migrations). Audit Logs was rated "Implemented, verified database-trigger-immutable" but the actual `/audit-logs` page was a single flat, unpaginated (`LIMIT 250`), two-filter table that never displayed `before_data`/`after_data` even though the table has always stored them. Compliance was rated "Missing as dedicated capability — only module-local (`accounting/compliance/requests`)" — confirmed by this prompt's audit to mean statutory tax-filing tracking (GST e-invoice/e-way bill/TDS), a different domain from personal-data privacy. `apps/web/src/core/navigation/governance.ts` contained exactly two items (Billing, Audit Logs) with an explicit code comment documenting the Compliance gap.

## 3. Billing Architecture

`/billing` remains a single server-rendered page (`apps/web/src/app/(app)/billing/page.tsx`) driving one client component (`billing-workspace.tsx`) — this was a deliberate architectural finding, not an oversight, and this prompt preserved it exactly as instructed ("If some of these are already tabs rather than routes: preserve that architecture. Do not generate duplicate pages solely to mirror the IA tree"). Two real gaps were closed, both purely in the view layer:

### Subscription
Unchanged. `organization_subscriptions.status` (`trialing, checkout_pending, authenticated, active, past_due, halted, cancelled, completed, expired, internal`) is the real, DB-enforced (CHECK constraint) status set, exactly mirrored in `packages/shared-types/src/core/billing.d.ts`'s `BillingSubscriptionStatus`. `getBillingSummary()` (`apps/web/src/core/billing.ts`) remains the single source of truth; no status value was invented or renamed.

### Plan
**New**: each plan card in `billing-workspace.tsx` now shows a collapsible "N of 12 modules included" list, computed as `plan.modules.includes("*") || plan.modules.includes(module.key)` against `ERP_MODULE_CATALOG` (`@vercentlabs/shared-types`) — the exact same 12-module catalogue Prompt 4/5's resolver uses, not a second hand-maintained list. `BillingPlanPrice.modules` already reached the browser before this prompt (passed as a prop) but was never rendered — this was pure dead data made visible, not new data plumbing.

### Usage
**New**: a "Usage" panel showing `summary.usage.api_requests_monthly` and `summary.usage.imports_rows_monthly` — confirmed by direct code inspection to be the **only two** dimensions `incrementBillingUsage()` is ever actually called with anywhere in the codebase (~40+ call sites for `api_requests_monthly`, one for `imports_rows_monthly`). `storage_bytes`, `automation_actions_monthly`, and `outbound_messages_monthly` are defined in `BillingPlanLimits`/`BillingUsageMetric` but never incremented — they are deliberately **not** shown, per Part 5's explicit instruction not to fabricate a comprehensive usage dashboard out of unmeasured dimensions. Where a real limit exists (`api_requests_monthly`), it renders as `Used / Limit`; the unlimited/uncapped `imports_rows_monthly` renders as a plain count, with no fake percentage bar.

### Invoices / Payments
Unchanged. Both remain mirrored from Razorpay webhook payloads into `billing_invoices`/`billing_payments` (upserted on `(provider, provider_invoice_id)`/`(provider, provider_payment_id)`), rendered from the existing last-20 queries. `invoice_url` remains Razorpay's own hosted `short_url` — no first-party PDF generation was added (none existed, none was requested).

### Billing Profile
Unchanged. `billing_customers` (legal name, billing email, phone, GSTIN, address; `country` fixed to `"IN"`) with its existing `billingProfileSchema` GSTIN regex validation, unchanged.

## 4. Module Entitlement Relationship

Untouched, and explicitly verified untouched by a dedicated test: `billing-workspace.tsx` never imports or calls `isModuleEntitled`/`resolveModuleAccess` — it only reads `plan.modules`/`summary.modules`, which is display data already computed by the existing `getBillingSummary()`/`isModuleEntitled()` pipeline (Prompt 4/5). Prompt 9's Billing UI is strictly a view over that pipeline, never a second interpretation of it — `organization_modules.status` (tenant enablement) and billing entitlement (`billing_plans.modules`) remain the two distinct concepts Prompt 4 established; this prompt did not conflate them anywhere in the new UI copy.

## 5. Payment Provider Security

Untouched. The Razorpay webhook handler's signature verification (`verifyRazorpayWebhookSignature`, constant-time HMAC-SHA256 with secret rotation support), idempotency (`billing_webhook_events` unique on `(provider, provider_event_id)`, confirmed still present in `005_billing_and_razorpay.sql` by a dedicated regression test), replay-window rejection, lease-based concurrent-delivery claiming, and out-of-order-event guarding were all read (to confirm reuse targets for the Usage/Plan display) but not modified. No adjacent security defect was found in this pass.

## 6. Audit Architecture

`audit_events` (control-plane, `001_auth_and_onboarding.sql` + `002_platform_foundation.sql`): `id, organization_id, actor_user_id, event_type, entity_type, entity_id, metadata, created_at, ip_address, user_agent, before_data, after_data`. The `prevent_audit_event_mutation()` trigger (`BEFORE UPDATE OR DELETE ON audit_events`, unconditional `RAISE EXCEPTION`) is untouched, and re-confirmed by a dedicated regression test. `audit()` (`apps/web/src/core/security.ts`) has 89 real call sites across 81 files; it performs **no redaction of its own** — every call site hand-curates what it passes, which is the structural gap Parts 42/43 address (Section 12).

**Important architectural fact carried into this prompt's design**: HR & Payroll, Procurement, and Support write to their own private, tenant-schema event tables (`tenant.hr_payroll_events`, `tenant.procurement_events`, `tenant.support_events`) — never to `audit_events`. Inspecting every mutation in those three modules confirmed none of them pass sensitive fields (bank details, employee PII, private-note bodies) into their own event payloads either (most pass no payload at all, or a small summary object). This means the Audit Logs workspace built in this prompt has **no visibility into those three modules** — a real, honest scope limitation, not a bug: `/audit-logs` surfaces exactly what `audit_events` contains (CRM, Accounting, Sales, Billing, Access, Auth, Settings, Approvals, Modules), and does not claim otherwise.

## 7. Audit Events

`/audit-logs` was rewritten (same route, same permission) to add: a date range (`dateFrom`/`dateTo`), an event-type category dropdown (a fixed list: Authentication/Access & roles/CRM/Accounting/Sales/Billing/Master data/Approvals/Modules — each maps to a real `LIKE 'prefix%'` filter), an entity-type filter, real pagination (bounded 50/page, `LIMIT`/`OFFSET`), and a CSV export button. The original free-text search (entity type/ID/actor email `ILIKE`) was preserved unchanged inside the new shared query function. All filtering logic lives in one new file, `apps/web/src/core/audit/query.ts` (`listAuditEvents`), reused identically by the page and by the export route — so the export can never diverge from what's on screen.

## 8. Record History

New: `/audit-logs/history`. Given an `entityType` + `entityId` (either entered directly or reached by clicking an entity link on the Audit Events table), it lists every `audit_events` row for that exact entity, ordered by time, with redacted before/after values shown in a collapsed detail panel per row. This is genuinely new capability built from data that already existed (`before_data`/`after_data` were captured but never displayed anywhere) — no diffing engine, just the existing rows for one entity.

## 9. User Activity

New: `/audit-logs/activity`. A workspace-member picker (queried from `organization_memberships`/`users`, scoped to the caller's own organization) followed by that member's `audit_events` history. Deliberately limited to what `audit_events` already captures (record changes, approvals, settings, module toggles) — no session-replay, keystroke, or invasive analytics of any kind, per Part 14's explicit instruction to keep this operational/security-oriented, not surveillance-oriented.

## 10. Security Events

New: `/audit-logs/security`. Two independently-paginated panels: (1) `audit_events` filtered to a hardcoded (never client-controlled) category — `event_type LIKE 'auth.%' OR 'access.%' OR = 'module.status_changed'`; (2) `login_events` (a separate control-plane table with no `organization_id` column — tenant-scoped here via an `INNER JOIN organization_memberships`, so a login attempt against an email with no membership in the caller's org can never appear, by construction rather than by an extra filter check). No MFA events are shown — confirmed by the research agent that no MFA factor/enrollment table exists anywhere in the schema (MFA today is flags-only), so none were fabricated.

## 11. Audit Export

`GET /api/audit-logs/export` — permission-gated (`audit.view`), reuses `listAuditEvents()` with the **exact same filter parameters** the Audit Events page sent (so export can never see more than the on-screen filtered view), bounded to 5,000 rows, redacted identically to the on-screen view (Section 12), and self-audits (`eventType: "audit.events.exported"`, recording the row count, total matched, and the filters used — not the exported content itself, avoiding any recursive-export concern). Follows the exact CSV pattern already established by `business-data/[resource]/export/route.ts` (BOM, `csvCell`, `Content-Disposition`, `Cache-Control: private, no-store`).

## 12. Redaction Model

`apps/web/src/core/audit/redact.ts` — `redactAuditPayload()` wraps the existing (previously unused for this purpose) `packages/observability` `redact()` — which already catches `password|token|secret|api[-_]?key|credential|session|authorization|cookie`-shaped keys — with one additional pattern for banking/PII-shaped keys matching the field names HR & Payroll and Procurement already protect on the read path: `bank*`, `iban`, `routing_number`, `account_number`, `tax_identifier`, `statutory_identifier`, `date_of_birth`, `personal_email/phone`, `emergency_contact`, `ssn`, `passport`, `aadhaar`, `pan_number`, `gstin`, `private_note`. Applied recursively (objects and arrays, depth-capped at 5, matching the existing `redact()` convention), and identically before both on-screen rendering (`AuditEventTable`) and CSV export — export is never a redaction bypass. Every audit-log page passes `metadata`/`before_data`/`after_data` through `redactAuditPayload()` before it reaches JSX, verified by a dedicated test across all four pages.

## 13. Compliance Workspace

New: `/compliance` (Overview), `/compliance/retention`, `/compliance/consent`, `/compliance/privacy-requests`, `/compliance/data-governance` — five real routes, each gated by the new `compliance.view` permission. The Overview page shows only provable status: active retention-policy count, open privacy-request count, 30-day consent-event count, current billing/subscription status (reusing `getBillingSummary()`, not a new billing read), "Audit trail: Enabled" (structurally always true given the trigger), and the last 6 governance-relevant audit events (a fixed prefix allowlist: `crm.privacy.`, `billing.`, `module.`, `access.`). No certification claim (GDPR/SOC 2/ISO/HIPAA compliant) appears anywhere — verified by a dedicated test across every Compliance page.

## 14. Retention

`/compliance/retention` reuses `getPrivacyRetentionDashboard(client, crmContext(session))` — the exact function CRM's own `/crm/privacy-retention` page already calls — verbatim, with zero new SQL. It is explicitly, honestly scoped in its own copy: "Configured retention windows for CRM customer data (leads, contacts, business partners)... retention policy is not yet configurable for other modules." Read-only in this new surface; a "Manage policies in CRM" link (shown only to users who also hold `crm.privacy.manage`) points to the existing mutation UI rather than duplicating it.

## 15. Consent

`/compliance/consent` reuses the existing `listCrmRecords(context, "consent-events", …)` resource (already defined in `services/api/src/modules/crm/index.js`, already immutable — attempting to archive/delete a consent event throws `CRM_CONSENT_IMMUTABLE`), rendering channel/purpose/action/lawful-basis/source/timestamp for the last 50 events per page, paginated. No new consent model was invented; the existing append-only evidence table (`tenant.crm_consent_events`) is the entire source.

## 16. Privacy Requests

`/compliance/privacy-requests` lists `tenant.crm_privacy_requests` across **all** subject types (lead/contact/party) — the existing table's real scope — via the existing `listCrmRecords(context, "privacy-requests", …)` resource, filterable by status, paginated. Reviewing a request links to the **existing** `/crm/privacy-requests/[id]` detail page (`previewPrivacyRequest`/`executePrivacyRequest`, with identity-verification, legal-hold, and blocker checks already built in) rather than re-implementing that preview/approve/reject/execute workflow a second time under a new URL — this keeps exactly one mutation code path for privacy actions. Statuses are the existing 6: `received, verification_pending, in_progress, completed, rejected, cancelled` — none were added, removed, or renamed. Completed requests cannot be reopened or archived (existing `CRM_PRIVACY_REQUEST_CLOSED` guards, untouched).

## 17. Data Governance

`/compliance/data-governance` is a status/inventory page only (Part 22's explicit framing: "primarily inventory, status, discoverability... does not need to implement every capability itself"). Ten capability cards, each either a real link or an honest status-only card with no destination:

| Capability | Status source | Destination |
|---|---|---|
| Shared masters | Static (16 resources, Prompt 8) | `/master-data` |
| Audit trail | Static (trigger structurally always present) | `/audit-logs` |
| Retention | Live query (`getPrivacyRetentionDashboard`) | `/compliance/retention` |
| Numbering series | Static (real admin UI exists) | `/settings/numbering-series` |
| Duplicate management | Static fact ("CRM lead duplicates only") | none — no dedicated admin page exists |
| Archiving & soft delete | Static fact (status-based, CRM + Master Data) | none |
| Record ownership | Static fact, explicitly caveats CRM-only scope | none |
| Master approval | Static fact (`packages/workflows`, used by Procurement/Accounting) | none |
| Bulk update | Static fact (CRM + Sales only, scattered) | none |
| Validation rules | Static fact (CRM lead-governance jsonb only) | none |

"Import templates" — named in Part 22's target topic list — is **not** included: confirmed absent from the repository by the research agent (zero matches for any import-template feature), and Part "do not fabricate unsupported controls" governs. This is a documented gap (Section 25), not a silently-dropped requirement.

## 18. Permissions/Roles

One new permission: `compliance.view` (added to `CORE_PERMISSIONS` in `packages/permissions/src/index.js`/`.d.ts`, flowing automatically into `ALL_PERMISSIONS`). Distinct from the existing `crm.privacy.manage` (which continues to gate every actual privacy/retention mutation, unchanged) — `compliance.view` is a narrower, **read-only**, cross-module visibility permission. Granted to `organization_owner` and `system_administrator` automatically (both hold `ALL_PERMISSIONS`), `company_administrator` automatically (its `ALL_PERMISSIONS`-minus-explicit-exclusions pattern does not exclude it), and explicitly added to `auditor`'s permission list in `access-control.ts` — Auditor's existing description ("Read-only governance, audit and released-module reporting access") squarely covers viewing compliance status even though Auditor deliberately still lacks `crm.privacy.manage` (unchanged, still enforced by `enterprise-rbac.test.mjs`'s existing least-privilege assertion). No new permission was added for Billing or Audit Logs — both already had a complete, correctly-scoped permission set (`billing.view/manage/checkout/audit`, `audit.view`).

## 19. Company/Branch/Tenant Scope

Every new query is organization-scoped as `$1` (audit_events, login_events via the `organization_memberships` join, CRM privacy/consent/retention data via the existing `crmContext()`/`recordScope()`/company-scoped resource definitions). Module access is not conflated with governance permission: Compliance's `crm_privacy_*`/`crm_consent_events` reads go through the same `companyScoped: true` resource definitions CRM's own pages use, so company/branch record scope is inherited automatically, not re-implemented.

## 20. Navigation Changes

`apps/web/src/core/navigation/governance.ts` now has exactly 3 items — Billing, Audit Logs, Compliance — matching the target IA's top level. Sub-destinations (Audit Events/Record History/User Activity/Security Events under Audit Logs; Overview/Retention/Consent/Privacy Requests/Data Governance under Compliance) are **not** separate sidebar entries — they're real routes reached via in-page tab-strips (Audit Logs) and metric-card links (Compliance Overview), the same "one flat destination per workspace group" pattern Billing already established (its own Subscription/Plan/Usage/Invoices/Payments/Billing Profile children have never been separate sidebar items either). This keeps the sidebar from growing by 9 new flat entries while every sub-route remains reachable and command-palette-searchable.

## 21. Command Palette Integration

No parallel search catalogue was created. Each of the 3 top-level items gained `keywords` covering their real children — Billing: `subscription, plan, usage, invoice, payment, billing profile`; Audit Logs: `audit events, record history, user activity, security events, export`; Compliance: `retention, consent, privacy, privacy requests, data governance` — so Prompt 7's existing `searchNavigation()` (which only ever reads the resolved `navigation` tree) finds them automatically once the item itself is permission-visible.

## 22. Database Changes

One new migration: `database/platform/migrations/030_compliance_permission.sql` — inserts `compliance.view` into `permissions`, then grants it to every existing organization's `organization_owner`/`system_administrator`/`company_administrator`/`auditor` system-role rows (matching migration 018/027's established `role_permissions` backfill pattern exactly). Applied to the live local database (`docker exec vercentlabs-postgres psql ...`): `INSERT 0 1` (permission row) + `INSERT 0 64` (16 organizations × 4 roles). No tenant-schema migration was needed — every Compliance data source reuses an existing table verbatim.

## 23. Tests Added

`apps/web/tests/governance.test.mjs` — 40 new tests: real execution of `redactAuditPayload()` (secret keys, banking/PII keys, nested structures, null-safety) and `sanitizePage`/`sanitizePageSize` (both extracted into a DB-free `audit/sanitize.ts` specifically so they could be executed rather than only source-matched, mirroring Prompt 8's `internal-href.ts` precedent); parameterization/no-SQL-injection checks on every `audit/query.ts` condition; permission gating and fail-closed (`notFound()`) checks across all 4 Audit Logs pages and all 5 Compliance pages; redaction-before-render checks; append-only enforcement (no PATCH/PUT/DELETE handler anywhere in the new workspace); export bounding/filtering/self-audit checks; Billing regression checks (subscription statuses match the real CHECK constraint, module-entitlement grid uses the real catalogue, usage section lists only the 2 truly-metered dimensions, webhook idempotency constraint untouched, entitlement resolution untouched); Compliance-specific checks (new permission distinct from `crm.privacy.manage`, CRM service functions reused verbatim, no certification claims, no fabricated compliance score, "import templates" absent, ownership copy caveats CRM-only scope); migration/role-backfill checks; navigation/keyword checks; and 3 security-regression tests (no raw `tenant.crm_privacy_*` query bypasses the CRM service layer, `audit_events` trigger untouched, no new file references HR/Procurement/Support's private event tables or sensitive columns).

## 24. Adversarial Review

1. **Can an ordinary user see billing management?** CLOSED — `billing.manage`/`billing.checkout` remain required for mutations; view-layer additions (Usage, module grid) only render data already gated by `billing.view`, unchanged from before this prompt.
2. **Can a user mutate another tenant's subscription?** CLOSED — no new billing mutation path was added; every existing billing route remains organization-scoped from `session.organizationId`, untouched.
3. **Can plan entitlement be spoofed client-side?** CLOSED — the module-entitlement grid renders `plan.modules`/`summary.modules`, both server-computed and passed as read-only props; nothing client-side computes or overrides entitlement.
4. **Can invoice/payment records leak across tenants?** CLOSED — unchanged `WHERE organization_id = $1` queries in `billing/page.tsx`, not touched by this prompt.
5. **Can payment provider secrets appear in UI?** CLOSED — confirmed no webhook secret, signing key, or raw provider payload is rendered anywhere in `billing-workspace.tsx`; the new Usage/module sections only read `summary.usage`/`plan.modules`.
6. **Can audit logs leak another tenant?** CLOSED — every function in `audit/query.ts` takes `organizationId` as `$1` and it is always the caller's own `session.organizationId`; `listLoginEvents` additionally requires an `organization_memberships` join, so it cannot leak login attempts belonging to any other tenant's users.
7. **Can audit history leak protected HR fields?** CLOSED — confirmed structurally impossible today (HR never writes to `audit_events` at all), and defensively closed too (`redactAuditPayload` catches HR-shaped keys if that ever changes).
8. **Can supplier banking details leak through audit payload?** CLOSED — same reasoning as #7 for Procurement, plus the banking-key redaction pattern as defense in depth.
9. **Can Support private notes leak through audit?** CLOSED — Support never writes to `audit_events`; `redactAuditPayload` additionally redacts any `private_note`-shaped key as defense in depth.
10. **Can tokens/secrets appear in audit UI/export?** CLOSED — `redactAuditPayload` is applied identically before both render paths, verified by a dedicated test that scans every audit page for the call.
11. **Can audit export ignore filters?** CLOSED — the export route calls the exact same `listAuditEvents()` with the exact same filter object the Audit Events page built from its own query string; there is no separate, wider export query.
12. **Can audit export become unbounded?** CLOSED — `EXPORT_ROW_LIMIT = 5_000`, enforced via `pageSize: EXPORT_ROW_LIMIT` passed into the same bounded query function.
13. **Can audit events be edited/deleted via new endpoints?** CLOSED — verified no page or the export route defines a PATCH/PUT/DELETE handler; the DB trigger remains the ultimate backstop regardless.
14. **Can compliance routes be accessed without permission?** CLOSED — every one of the 5 Compliance pages checks `hasPermission(session, PERMISSIONS.complianceView)` before any data fetch, verified by a dedicated test.
15. **Can retention policy be changed by normal users?** CLOSED — `/compliance/retention` is read-only; the only mutation path remains `/crm/privacy-retention`, still gated by `crm.privacy.manage`, unchanged.
16. **Can retention setting directly delete protected data unexpectedly?** N/A — no retention execution/mutation logic was added or modified in this prompt; `runPrivacyRetention` (pre-existing) was not touched or wired into any new page.
17. **Can consent records leak PII?** CLOSED/acceptable — consent events reference lead/contact/party IDs only (no free-text PII beyond what CRM's own `crm.view` permission already exposes); the page itself requires `compliance.view`, granted only to governance-appropriate roles.
18. **Can privacy request reveal customer data to unauthorized staff?** CLOSED — the list view shows only request metadata (type/subject reference/requester contact/status/due date), gated by `compliance.view`; the actual subject record preview remains behind the existing `/crm/privacy-requests/[id]` page's own `crm.privacy.manage` gate.
19. **Can privacy request execute immediate hard deletion?** CLOSED — Compliance adds no execute/mutate action at all; the existing `executePrivacyRequest` workflow (identity verification, legal-hold check, soft anonymize/restrict operations) is entirely unmodified and unreachable from any new Compliance page.
20. **Can invalid privacy status transitions occur?** N/A — no new transition logic was added; existing `CRM_PRIVACY_REQUEST_CLOSED` guards (completed requests cannot reopen/archive) are untouched.
21. **Can client spoof request ownership/assignee?** CLOSED — no new mutation route was added; the list/read routes accept no assignee/owner input at all.
22. **Can Data Governance claim capabilities that do not exist?** CLOSED — every capability card's status string was verified against real code/queries in this pass; "Import templates" was deliberately excluded rather than fabricated, verified by a dedicated test.
23. **Can UI claim certification Vercentlabs does not hold?** CLOSED — verified by a dedicated test scanning every Compliance page for GDPR/SOC 2/ISO/HIPAA-compliant phrasing; none found.
24. **Can module entitlement UI disagree with Prompt 5 resolver?** CLOSED — Billing's new UI reads `plan.modules`/`summary.modules` exclusively; it does not call or reimplement `resolveModuleAccess`/`isModuleEntitled`, verified by a dedicated test.
25. **Can billing-provider failure open entitlement access?** N/A — no entitlement-enforcement logic was touched; `assertModuleEntitlement`'s fail-closed behavior (Prompt 4) is unmodified.
26. **Can repeated webhook duplicate a payment?** CLOSED — `billing_webhook_events` unique `(provider, provider_event_id)` constraint (migration 005) is untouched, re-confirmed by a dedicated regression test.
27. **Can company/branch context leak governance records?** CLOSED — every Compliance data read goes through the existing `companyScoped: true` CRM resource definitions, inheriting company/branch scoping automatically.
28. **Can filter/sort query inject SQL?** CLOSED — every dynamic condition in `audit/query.ts` is built with a bound `$N` placeholder (verified by a dedicated test scanning every `conditions.push(...)` call); sort order is a fixed `ORDER BY created_at DESC`, never client-controlled.
29. **Can massive audit JSON crash the page?** CLOSED — detail JSON renders inside a collapsed `<details>` per row (never inline in a table cell), and `redactAuditPayload`'s underlying `redact()` truncates any string over 2,000 characters and caps arrays/objects at 100 entries.
30. **Can a governance adapter fail open?** CLOSED — the Compliance Overview page wraps every source query in `Promise.allSettled` with explicit fallback values (`0`, `"unknown"`) on rejection; no source failure can silently substitute unscoped or fabricated data.

## 25. Remaining Gaps

**P1**:
- Retention, Consent, and Privacy Requests are genuinely CRM-scoped (lead/contact/party subjects only) — extending them to other modules' personal data (HR employees, support contacts) would require either widening `crm_privacy_requests.subject_type`'s CHECK constraint or a new parallel table, and was judged out of scope for this prompt (Part 21 permits building "only if current data model supports them," and it does not yet support non-CRM subjects).

**P2**:
- Audit Logs has no visibility into HR & Payroll, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, or Support mutations — those 9 modules write to their own private per-module event tables, never `audit_events`. Unifying them (or building a cross-table union view) is a real, evidence-backed gap for a future prompt, not fixed here per Part 6's instruction not to retrofit module-enablement-style changes broadly in this pass.
- Data Governance's "Duplicate management," "Bulk update," "Master approval," and "Validation rules" cards are informational only (no dedicated admin destination exists to link to) — accurately described as such rather than linked to a stub.

**P3**:
- The Compliance sidebar entry relies entirely on keyword-based command-palette discovery for its 4 sub-pages rather than a visually-grouped sidebar sub-section (the existing `NavigationCollection` renderer has no group-subheading support, unlike `NavigationSection`) — functionally complete but a minor discoverability/polish gap versus a dedicated collapsible section.
- `pnpm release:verify`'s landing e2e suite outcome for this prompt is reported in Section 27 based on the actual completed run, not assumed from Prompt 8's differing failure signature.

## 26. Files Changed

**New**: `database/platform/migrations/030_compliance_permission.sql`; `apps/web/src/core/audit/{redact,sanitize,query}.ts`; `apps/web/src/components/{audit-event-table,governance-pagination}.tsx`; `apps/web/src/app/(app)/audit-logs/{history,activity,security}/page.tsx`; `apps/web/src/app/(app)/compliance/{page.tsx,retention/page.tsx,consent/page.tsx,privacy-requests/page.tsx,data-governance/page.tsx}`; `apps/web/src/app/api/audit-logs/export/route.ts`; `apps/web/tests/governance.test.mjs`.

**Modified**: `packages/permissions/src/{index.js,index.d.ts}` (compliance.view); `apps/web/src/core/access-control.ts` (Auditor gains compliance.view); `apps/web/src/core/navigation/governance.ts` (Compliance item + keywords); `apps/web/src/app/(app)/audit-logs/page.tsx` (strengthened Audit Events view); `apps/web/src/core/components/billing-workspace.tsx` (Usage section, plan module grid); `apps/web/src/app/globals.css`, `apps/web/src/app/billing-extension.css` (supporting styles).

## 27. Verification Results

| Command | Result |
|---|---|
| `pnpm --filter web typecheck` | **PASS** (clean) |
| `pnpm --filter web lint` | **PASS** (0 errors, 1 pre-existing unrelated warning) |
| `apps/web/scripts/verify-routes.mjs` | **PASS** — 130 pages, 282 routes, 128 navigation hrefs, 0 failures |
| `pnpm --filter web build` | **PASS** — all new routes present in the route manifest (`/audit-logs/{history,activity,security}`, `/compliance/{,retention,consent,privacy-requests,data-governance}`, `/api/audit-logs/export`) |
| `pnpm --filter web test` | **PASS — 221/221** (181 pre-existing + 40 new, 0 failures) |
| `pnpm verify:fast` | **PASS** (subsumed by full `pnpm verify` run below) |
| `pnpm verify` | **PASS** — full composite (typecheck, lint, test:web, test:api, verify:routes, verify:mobile, verify:db, test:sdk, test:packages, test:integration, test:security, test:enterprise-rbac), exit 0 |
| `pnpm release:verify` | See the final chat response for the actual completed result (run in background due to its length; landing-only outcomes are reported separately from ERP results, per the standing instruction not to assume Prompt 8's differing landing-e2e failure signature recurs). |
