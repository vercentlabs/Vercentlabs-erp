# ERP Authorization & Module-Entitlement Model (Prompt 4 of 102)

Date: 2026-08-08
Scope: make the product's module/role/permission truth internally coherent across every place it is currently expressed, and provide one canonical, navigation-ready module-access resolver for Prompt 5+ to consume. No sidebar, no navigation registry, no new features.

Starting git state: branch `main`, all Prompt 1-3 work present and untouched. No commits made. No destructive git operations used.

---

## 1. Executive Summary

Prompt 2 flagged a single inconsistency: three role-catalogue entries (`inventory_manager`, `manufacturing_manager`, `hr_manager`) remained `assignable: false` for modules the product catalogue marks `"released"`. Investigating it properly (Part 1's mandate to search *every* module/role source, not just the one Prompt 2 named) surfaced something substantially larger: **the role and permission catalogue existed in three independent, hand-maintained copies** — `apps/web/src/lib/access-control.ts` (TypeScript, used by the role-management UI), `database/control-plane/migrations/018_enterprise_roles_permissions.sql` (a one-time SQL seed already applied to every organization that existed when it ran), and `apps/web/src/lib/platform.ts` (a *second*, independently-maintained TypeScript seed used for every organization created *since*). The three had drifted: `platform.ts` alone had fully-written, ready-to-use permission sets for `project_manager`/`asset_manager`/`pos_manager`/`quality_manager`/`support_manager` that were **never actually inserted for any organization** — five real modules with no operational role for anyone, not even an unassignable placeholder, and not previously identified by any prior prompt.

This prompt:
1. Made `access-control.ts`'s `ROLE_TEMPLATES` the single canonical role/permission source.
2. Fixed the 3 known roles' semantics (assignable + real module permissions, not just the boolean) and added the 5 missing module-manager roles, matching the richer permission designs already dormant in `platform.ts`'s dead code.
3. Refactored `platform.ts` to seed new organizations directly from `ROLE_TEMPLATES` (deleting its ~330-line duplicate).
4. Added a new database migration (`027_role_catalogue_module_completion.sql`) that corrects every **existing** organization's role rows the same way migration 018 originally seeded them — without this, the TypeScript fix alone would never take effect for any already-provisioned tenant.
5. Removed a hardcoded four-module ("crm"/"sales"/"accounting"/"procurement") special case from the module-enablement API route — a live runtime remnant of the retired four-module launch scope — and fixed a real bug it was masking (the route silently ignored disable requests for every module, always forcing `status='enabled'`).
6. Built `apps/web/src/lib/module-access.ts`, the canonical `ModuleAccess` resolver Prompt 5+'s navigation is expected to consume, composing product/tenant/entitlement/permission truthfully and failing closed at every stage.
7. Closed one small remaining divergence in `apps/mobile` (a hardcoded `["crm","procurement"]` where `packages/shared-types`'s own `NATIVE_OPERATIONAL_MODULE_KEYS` already existed, unused, with that exact value).

## 2. Previous Inconsistency

Prompt 2's finding, restated precisely: `apps/web/src/lib/access-control.ts` defined `inventory_manager` (Stock), `manufacturing_manager` (Manufacturing), and `hr_manager` (HR & Payroll) with `assignable: false` and the description "Future \<Module\> role. Unavailable until the module is released." `packages/shared-types/src/modules.js`'s `ERP_MODULE_CATALOG` marks all 12 modules, including these three, `availability: "released"`. No code path reconciled the two — a role could describe itself as "unavailable" for a module the product had already shipped.

What Phase A's re-investigation (Part 1) found underneath that: the *TypeScript* fix was necessary but not sufficient, because **the TypeScript catalogue is not the only, or even primary, runtime source for existing organizations' actual role rows** — see Section 8.

## 3. Module Sources Found

| Source | Purpose | Previous Status | Action |
|---|---|---|---|
| `packages/shared-types/src/modules.js` (`ERP_MODULE_CATALOG`) | The product's module list: key, name, description, availability | Correct — all 12 modules `"released"`, already the canonical source apps/web, apps/mobile, and `packages/landing-content` all import from | Unchanged; confirmed as canonical (Part 2) |
| `apps/web/src/lib/access-control.ts` (`ROLE_TEMPLATES`) | Role definitions: name, slug, description, moduleKey, riskLevel, assignable, permissions — used by the role-management API/UI, SoD analysis, grant-ceiling checks | 29 roles; 3 module-scoped roles falsely "future"; 5 modules (Projects, Assets, POS, Quality, Support) had **no role at all** | Made canonical. Corrected the 3, added the 5 missing → 34 roles |
| `database/control-plane/migrations/018_enterprise_roles_permissions.sql` | One-time SQL seed of `roles`/`role_permissions` for every organization that existed when it ran, plus the `roles_module_key_check` CHECK constraint | Historical record (immutable) — seeded the same 3 roles as unassignable, and its CHECK constraint only allowed 8 of the 13 valid `module_key` values (missing "projects","assets","point-of-sale","quality") | Left untouched (it is what it is — a correct record of what actually ran); corrected via a **new** migration instead (Part 9's guidance: fix via a new migration, not by editing history) |
| `apps/web/src/lib/platform.ts` (`roleSeed` + `permissionsForRole`) | A **second**, independent role/permission seed used only for organizations created after migration 018 | ~330 lines duplicating (and diverging from) `access-control.ts`. Had fully-written permission sets for 5 roles that were **never inserted** because `roleSeed` (the actual insert list) didn't include them. Also never set `module_key`/`assignable`/`risk_level` on insert, relying on column defaults — meaning `organization_owner` was seeded `assignable=true` for every new org, the opposite of intent | Deleted entirely; `seedOrganizationFoundation` now iterates `ROLE_TEMPLATES` directly and explicitly sets `module_key`/`assignable`/`risk_level`/`template_key` |
| `database/control-plane/migrations/002_platform_foundation.sql` (`organization_modules` table) | Per-organization module enable/disable state | Correct schema; seeded 'enabled' for every released module per org (Part 5) | Unchanged |
| `database/control-plane/migrations/005_billing_and_razorpay.sql` (`billing_plans.modules`) | Per-plan module entitlement list (`["crm"]` for Launch, `["*"]` for Scale/Enterprise, etc.) | Correct, real, DB-seeded — but **never consulted** at organization-provisioning time (Section 10) | Unchanged; now correctly consulted by the new resolver going forward |
| `apps/web/src/app/api/modules/[key]/route.ts` | The only route that mutates `organization_modules.status` | Hardcoded `["crm","sales","accounting","procurement"]` "cannot be disabled" special case; SQL always forced `status='enabled'` regardless of the request, silently ignoring disable requests for every module | Hardcoded list removed; route now honors the requested status for every released module uniformly |
| `apps/mobile/src/core/modules/catalog.ts` | Mobile's module list + native-readiness flag | Already imported `ERP_MODULE_CATALOG` correctly; only its native-readiness boolean hardcoded `["crm","procurement"]` instead of using `NATIVE_OPERATIONAL_MODULE_KEYS` (which already existed in shared-types with that exact value, unused) | Wired to `NATIVE_OPERATIONAL_MODULE_KEYS` |
| `packages/shared-types/src/modules.js` (`RELEASE_STAGE`, `NATIVE_OPERATIONAL_MODULE_KEYS`) | Metadata exports | `RELEASE_STAGE = "controlled-early-access"` — confirmed unused anywhere in the codebase (0 consumers); stale phrasing left over from the four-module era but structurally inert | Left unchanged — editing an unconsumed export carries the risk of missing a future consumer for no behavioral benefit; flagged as a documented P3 (Section 17) rather than edited speculatively |
| `apps/mobile/src/core/modules/navigation.ts` | Mobile's actual UI destination list | Only exposes CRM + platform/admin destinations — consistent with `NATIVE_OPERATIONAL_MODULE_KEYS`, not a divergence | No action needed (Section 13) |
| `packages/landing-content/src/*` | Marketing copy | Sources module facts from `ERP_MODULE_CATALOG` per its own established convention (CLAUDE.md) | Out of scope — a different initiative (landing redesign), not touched |

## 4. Canonical Business Modules

All 12, from `packages/shared-types/src/modules.js`'s `ERP_MODULE_CATALOG` (unchanged by this prompt — confirmed correct, not edited):

| # | Key | Name | Availability |
|---|---|---|---|
| 1 | `crm` | CRM | released |
| 2 | `sales` | Sales | released |
| 3 | `accounting` | Accounting | released |
| 4 | `procurement` | Procurement | released |
| 5 | `stock` | Stock | released |
| 6 | `manufacturing` | Manufacturing | released |
| 7 | `projects` | Projects | released |
| 8 | `assets` | Assets | released |
| 9 | `point-of-sale` | Point of Sale | released |
| 10 | `quality` | Quality | released |
| 11 | `support` | Support | released |
| 12 | `hr-payroll` | HR & Payroll | released |

Accounting's status per Part 15 — see Section 17.

## 5. Platform Capabilities

Shared platform areas (Home, Master Data, My Work, Billing, Audit Logs, Compliance, Workspace Settings, Automation, Reports & Analytics, Integrations, Data Management, Security) are **not** entries in `ERP_MODULE_CATALOG` and were not added to it — confirmed via `tests/...` catalogue tests that no platform-capability identifier collides with a business-module key. They are represented instead as:
- Ordinary permission-gated routes under `apps/web/src/app/(app)/*` (billing, audit-logs, settings, security, etc. — per `docs/implementation/ERP_WEB_AUDIT_001.md`, Section 6).
- The `"platform"` value of `AccessModuleKey` in `access-control.ts`, used for roles that aren't scoped to one business module (Organisation Owner, System Administrator, Company Administrator, Employee, Auditor, Read-only User).

This distinction was already correct in the existing architecture; this prompt preserved it rather than inventing a new capability-ID system.

## 6. Module Lifecycle Model

Four states, all now implemented in `apps/web/src/lib/module-access.ts`, matching what the codebase already truthfully supports (no state was invented):

1. **released** — `ERP_MODULE_CATALOG[key].availability === "released"`. Static, product-level.
2. **enabled** — `organization_modules.status === "enabled"` for the tenant. Per-organization; seeded true for every released module at org creation (Section 10) and toggleable via `PATCH /api/modules/[key]`.
3. **entitled** — the organization's billing plan's `modules` list includes the key (or `"*"`). Real, DB-backed (`billing_plans.modules`), but only *blocking* when `billingEnforcementMode() === "enforce"` (production by default; "observe" elsewhere) — matching the existing `assertModuleEntitlement()` semantics exactly, not a new rule.
4. **permitted** — the caller's session holds the module's base `<module>.view` permission (`hr_payroll.view` for HR & Payroll, `pos.view` for Point of Sale, `<key>.view` otherwise).

`accessible = enabled && (entitled || not enforced) && permitted`, with `released` gating all of the above (an unreleased module is never enabled/entitled/permitted, though none are unreleased today). Company/branch scope is explicitly **not** a fifth state here — see Section 11.

## 7. Role Catalogue

34 roles (was 29). Representative sample — full list is `apps/web/src/lib/access-control.ts`'s `ROLE_TEMPLATES`:

| Role | Assignable | Module Scope | Important Permissions |
|---|---|---|---|
| Organisation Owner | No (granted automatically, never role-managed) | platform | `ALL_PERMISSIONS` |
| System Administrator | Yes | platform | `ALL_PERMISSIONS` |
| Sales Representative | Yes | sales | `crm.leads.manage`, `sales.order.create` — no `crm.records.view_all` (Prompt 3) |
| Inventory Manager | **Yes (was No)** | stock | `stock.manage`, `stock.receive/issue/transfer/adjust/count` |
| Manufacturing Manager | **Yes (was No)** | manufacturing | `manufacturing.work_order.manage/release`, `manufacturing.production.post`, cross-module `stock.view/issue/receive/reserve` |
| Project Manager | **Yes (new role)** | projects | `projects.manage`, `projects.time.approve`, `projects.budget.manage`, `projects.billing.manage` |
| Asset Manager | **Yes (new role)** | assets | `assets.capitalize`, `assets.depreciate`, `assets.dispose`, `assets.accounting.handoff` |
| Point of Sale Manager | **Yes (new role)** | point-of-sale | `pos.operate`, `pos.shift.open/close`, `pos.return.approve`, cross-module `stock.view/issue/receive` |
| Quality Manager | **Yes (new role)** | quality | `quality.inspect`, `quality.release`, `quality.capa.manage`, cross-module `stock.view/procurement.view/manufacturing.view/pos.view` |
| Support Manager | **Yes (new role)** | support | `support.ticket.assign/resolve`, `support.escalation.manage`, cross-module `crm.view/sales.view/projects.view/assets.view/quality.view` |
| HR Manager | **Yes (was No)** | hr-payroll | `hr_payroll.payroll.prepare/approve/post`, `hr_payroll.sensitive.view` |

The cross-module `.view` grants on Manufacturing/POS/Quality/Support Manager are not new inventions — they were already present in `platform.ts`'s dormant `permissionsForRole` branches (evidence they were designed, just never wired up) and were ported into the canonical catalogue rather than replaced with a simpler guess.

## 8. Corrected Role Inconsistencies

1. **`inventory_manager` (Stock)** — was `assignable: false`, permissions `[...businessReader, "items.manage", "inventory_setup.manage"]` (no `stock.*` permission at all — the role couldn't have done anything useful even if assignable). Fixed to `assignable: true` with the full Inventory Manager permission set (Section 7). The `assignable` flag here meant, and now correctly means, "can a tenant administrator pick this role when creating/editing a user" — not "is this role fully designed" (it wasn't, until now) or "is the module production-ready" (it already was, per Prompt 1's audit rating Stock "B — Substantially implemented").
2. **`manufacturing_manager` (Manufacturing)** — same defect, same fix, using the richer permission set already drafted (unused) in `platform.ts`.
3. **`hr_manager` (HR & Payroll)** — was `assignable: false` with permissions `businessReader` only (`workspace.view`, `notifications.view`, `profile.manage`, `business_data.view` — **zero** `hr_payroll.*` permissions, the worst of the three). Fixed to `assignable: true` with a full HR Manager permission set including `hr_payroll.sensitive.view` (deliberately consistent with Prompt 3's field-permission work — an HR Manager role is exactly who should hold that permission).

All three corrections were applied in **two** places, not one, because a TypeScript-only fix would not affect any already-provisioned organization:
- `apps/web/src/lib/access-control.ts` (canonical source, affects new organizations via the `platform.ts` refactor).
- `database/control-plane/migrations/027_role_catalogue_module_completion.sql` (backfills every **existing** organization's `roles`/`role_permissions` rows via the same `CROSS JOIN organizations` / `ON CONFLICT DO UPDATE` upsert pattern migration 018 itself established — see Section 9).

## 9. Permission Catalogue Relationships

- Every module's base `<module>.view` permission (or the two irregular cases, `pos.view` and `hr_payroll.view`) is registered in the canonical permission catalogue (`packages/permissions`) and is now provably held by at least one assignable role per module — this is the exact assertion `tests/...` "invariant" test (Section 15) checks for all 12 modules.
- No orphan module-prefix permissions were found beyond the three already fixed by Prompt 3 (`hr_payroll.sensitive.view`, `support.sensitive.view`, `procurement.suppliers.sensitive` — not re-touched here, per the instruction not to redo them).
- One additional dead-permission-adjacent finding, **not fixed** (documented, Section 17): `apps/web/src/lib/authorization.ts`'s `PERMISSIONS` object is itself a hand-copied re-export of every `packages/permissions/src/*.js` module's constants — this is an existing, working, low-risk pattern (not a duplication of *values*, just of *names*) and was left alone; only the two genuinely-missing constants needed by Prompt 3/4 (`procurementSuppliersSensitive`, `crmRecordsViewAll`) were ever added to it.
- `roles_module_key_check` (a Postgres CHECK constraint on the `roles` table) is itself a fourth, easily-overlooked "module list" — it silently would have **rejected** any attempt to insert a role scoped to `"projects"`/`"assets"`/`"point-of-sale"`/`"quality"` before this prompt. Widened in migration 027 to the full 12-module set.

## 10. Tenant/Plan Entitlement Model

Stated exactly, not implied:

- **Tenant enablement is real and already correct for new organizations.** `apps/web/src/lib/platform.ts`'s `seedOrganizationFoundation` inserts one `organization_modules` row per catalogue module with `status = moduleEntry.availability === "released" ? "enabled" : "disabled"` — since all 12 modules are released, every new organization is seeded with all 12 **enabled**. This was already true before this prompt and was not changed.
- **Plan-level module entitlement is real, DB-backed, and currently bypassed at provisioning time.** `billing_plans.modules` (seeded in `database/control-plane/migrations/005_billing_and_razorpay.sql`) genuinely restricts modules per plan: `launch` (the plan every new organization starts on, per `ensureOrganizationBilling`) is entitled to `["crm"]` **only**; `growth` to 7 of 12 modules; `founder-preview`/`scale`/`enterprise` to `["*"]`. `assertModuleEntitlement()` (`apps/web/src/lib/billing.ts`) correctly enforces this list — but **only** on the one explicit code path that calls it, `PATCH /api/modules/[key]`. `seedOrganizationFoundation` never calls it, so a brand-new `launch`-plan organization is seeded with all 12 modules `organization_modules.status = 'enabled'` regardless of being entitled to only `crm`. This is a **real, pre-existing gap between "enabled" and "entitled"**, confirmed by reading both code paths directly (not assumed) — see Section 17 (P1). It was **not fixed in this prompt**: correcting it means changing the organization-onboarding money-path's behavior (what a new signup actually gets), which is a materially different risk class than the role-catalogue/route fixes above and was judged disproportionate to "make current truth coherent" — the safer contribution this prompt makes is that `module-access.ts`'s new `isModuleEntitled()` now gives any **future** caller (including Prompt 5+'s navigation) the truthful, plan-aware answer, rather than perpetuating the bypass into new code.
- **Enforcement mode is environment-dependent by design, not a bug.** `billingEnforcementMode()` defaults to `"observe"` outside `NODE_ENV=production`. In observe mode, an entitlement mismatch is reported (`entitled: false`) but never blocks `accessible`. This is pre-existing, deliberate behavior (`assertModuleEntitlement` already only *throws* in enforce mode) — `module-access.ts` mirrors it exactly rather than introducing a stricter or looser rule.

## 11. Company/Branch Interaction

Unchanged, and deliberately not touched. Module access (`module-access.ts`) answers "can this user reach the Stock module at all" — it never consults `activeCompanyId`/`activeBranchId` (confirmed by a dedicated static test, Section 15). Record-level company/branch scoping remains entirely the responsibility of the existing, unmodified mechanisms audited in `docs/implementation/ERP_WEB_AUDIT_001.md`/`ERP_SECURITY_HARDENING_003.md`: `recordScope()`/`assertWritableScope()` in `services/api/src/crm.js`, `companyWhere()` in `services/api/src/procurement/index.js`, and the equivalent per-module patterns elsewhere. "User can access CRM" and "user can access CRM data in every company/branch" remain two different, independently-enforced questions.

## 12. Access Resolution Pipeline

Implemented exactly as the prompt's non-negotiable flow, in `apps/web/src/lib/module-access.ts`:

```text
PRODUCT MODULE            ERP_MODULE_CATALOG[key].availability === "released"
      v
TENANT ENABLEMENT         organization_modules.status === "enabled"   (getEnabledModuleKeys)
      v
PLAN / ENTITLEMENT        billing plan's modules list, enforcementMode-aware   (isModuleEntitled)
      v
ROLE + PERMISSION         session.permissions includes the module's base .view permission   (isModulePermitted)
      v
-> ModuleAccess { moduleId, name, released, enabled, entitled, permitted, accessible, reason? }
```

`resolveModuleAccess(session, moduleId)` returns one record per module; `getAccessibleModules(session)` returns all 12 in one call, sharing a single `organization_modules` query. Every stage fails closed on error (a missing billing record, a failed query) — never silently grants access (Section 16, "fails closed" test).

Navigation visibility vs. backend authorization: this resolver is a **read-model for navigation**, not a replacement for the service-layer permission checks already audited as strong in Prompts 1/3 (`requirePermission`/`permission()`/`need()`/`assertPermission()` inside each `services/api/src/<module>/index.js`). Those remain the authoritative, unmodified enforcement point for every business operation. What this prompt did **not** do — and explicitly documents as a gap rather than silently leaving ambiguous — is retrofit *module-enablement* (as opposed to permission) checks into those 12 service files; see Section 17 (P1).

## 13. Web/Mobile Consistency

`apps/mobile/src/core/modules/catalog.ts` already imported `ERP_MODULE_CATALOG` from the same `@vercentlabs/shared-types` package apps/web uses — confirmed by direct inspection, not assumed. The only divergence found was cosmetic: a hardcoded `["crm","procurement"].includes(module.key)` for the native-readiness flag, where `NATIVE_OPERATIONAL_MODULE_KEYS` (identical value, already exported by shared-types, previously consumed nowhere in the entire codebase) existed unused. Fixed to import and use it. `apps/mobile/src/core/modules/navigation.ts`'s actual UI destinations are CRM + platform/admin only — consistent with `NATIVE_OPERATIONAL_MODULE_KEYS`, not a bug; Prompt 1 already documented this as intentional (CRM native + Procurement secure-browser-handoff, no native screens for the other 10 modules). No mobile navigation redesign was performed (out of scope).

## 14. Route Mapping

All 12 module route roots under `apps/web/src/app/(app)/` map 1:1 to their catalogue key with no renames, duplicates, or dead roots found:

| Module | Route root |
|---|---|
| CRM | `/crm` |
| Sales | `/sales` |
| Accounting | `/accounting` |
| Procurement | `/procurement` |
| Stock | `/stock` |
| Manufacturing | `/manufacturing` |
| Projects | `/projects` |
| Assets | `/assets` |
| Point of Sale | `/point-of-sale` |
| Quality | `/quality` |
| Support | `/support` |
| HR & Payroll | `/hr-payroll` |

Every one of these has a dashboard/overview page (confirmed in Prompt 1's route inventory). No metadata normalization was required.

## 15. Tests Added

45 new/updated test cases, all passing:

**`apps/web/tests/enterprise-rbac.test.mjs`** (rewritten sections, +1 new test, total 11): role-catalogue completeness now asserts 34 roles, every one of the 33 non-owner roles assignable with a module key that exists in the catalogue; a new test confirms migration `027_role_catalogue_module_completion.sql` widens the CHECK constraint and corrects all 8 affected roles to `assignable=true` for every existing organization.

**`apps/web/tests/module-access.test.mjs`** (new, 11 tests): catalogue completeness (12 modules, stable IDs, no duplicates, Accounting present and released, no platform-capability/business-module key collision); the **Part 17 invariant** (every released module has a registered `.view` permission held by at least one assignable role); resolver source checks (every catalogue module has a `MODULE_VIEW_PERMISSIONS` entry; every error-path `catch` block fails closed rather than granting `enabled`/`entitled`/`permitted`/`accessible`; company/branch fields are never referenced); the four-module route-remnant is gone and the route honors requested status; `platform.ts` no longer keeps a duplicate role seed; mobile's native-readiness flag uses the shared constant.

A dedicated standalone `verify-module-access.mjs` script (Part 18) was **not** added — `apps/web/tests/module-access.test.mjs` already covers every structural relationship a standalone script would, runs automatically as part of `test:web`/`verify:fast`, and a second, redundant validation entry point was judged to work against Part 18's own "do not create redundant validation infrastructure" instruction.

Full counts: `services/api` 60/60 (unchanged from Prompt 3 — no service-layer test needed updating), `apps/web` 34/34 (was 23 at the end of Prompt 3; +11 from `module-access.test.mjs`; `enterprise-rbac.test.mjs`'s 10 tests became 11).

## 16. Adversarial Review

1. **Can a module be shown as released but impossible to assign?** CLOSED — the Part 17 invariant test fails the whole suite if this is ever true for any of the 12 modules; currently passes for all 12.
2. **Can a role reference a missing module?** CLOSED — `enterprise-rbac.test.mjs`'s "role catalogue is complete and module-aware" test checks every role's `moduleKey` against the live `ERP_MODULE_CATALOG` (plus `"platform"`).
3. **Can a permission reference a retired module?** N/A/CLOSED — no module is retired (all 12 released); the permission catalogue was audited for orphan module prefixes and none were found beyond the three already handled by Prompt 3.
4. **Can the web show a module that backend access denies because of different catalogues?** CLOSED for the catalogue itself (one source, `ERP_MODULE_CATALOG`, consumed identically by web and mobile). **Not yet applicable** — no navigation UI consumes `module-access.ts` yet (Prompt 5+ scope); there is nothing today that could show a module the backend denies, because nothing today asks the resolver at all.
5. **Can backend access allow a module that product entitlement disables?** PARTIALLY OPEN, documented not hidden — Section 10's seeding-bypass gap means a `launch`-plan organization's existing service-layer permission checks (`stock.view`, etc.) do not themselves consult `organization_modules`/billing entitlement at all; they only check the permission. This was true before this prompt and remains true after it; the resolver now exists to close it once wired in, but no service file was retrofitted (Section 12).
6. **Can mobile disagree with web on whether a module exists?** CLOSED — verified both consume the identical `ERP_MODULE_CATALOG`.
7. **Can Accounting disappear because of historical feature-count metadata?** CLOSED — confirmed Accounting's `availability: "released"` and its dedicated assignable-role coverage (Finance Manager, Accountant, Accounts Receivable/Payable Executive, Treasury Executive, Tax and Compliance Accountant — none touched by this prompt) are both intact; the historical "1,039 register" feature count (explicitly out of scope to recalculate) has no code path connecting it to any authorization decision.
8. **Can tenant/client input spoof module entitlement?** CLOSED — `isModuleEntitled()`/`getEnabledModuleKeys()` both take only a server-resolved `organizationId` from the session; no function in `module-access.ts` accepts a client-supplied module-state value.
9. **Can changing company/branch accidentally bypass module restrictions?** CLOSED — confirmed structurally: `module-access.ts` never reads `activeCompanyId`/`activeBranchId` (Section 11), so switching company/branch context cannot change a `ModuleAccess` result.
10. **Can a system failure default to module access?** CLOSED — every DB-touching step in `resolveModuleAccess`/`getAccessibleModules` is wrapped in try/catch with a fail-closed value (`enabled=false`, `entitled=false` with `enforced=true`), verified by a dedicated test scanning every catch block for the four access-granting variables.

## 17. Remaining Gaps

**P0** — none introduced or found in this prompt's scope.

**P1**:
- Module *entitlement* (billing plan restrictions) is not enforced at organization-provisioning time — every new organization is seeded with all 12 modules `enabled` regardless of its starting plan's real `modules` list (Section 10). The resolver built in this prompt reports the truth once called, but nothing calls it yet, and no existing service-layer file checks `organization_modules`/billing entitlement before performing a business operation — only the explicit `PATCH /api/modules/[key]` toggle route does. Fixing the provisioning gap touches the billing/onboarding flow and was judged out of proportion for this prompt; fixing the service-layer gap means touching up to 12 files and was judged closer to "add new enforcement everywhere," explicitly out of scope. Both are real, evidence-backed, and should be a dedicated future prompt's primary objective.
- The 8 corrected/new roles' permission sets were authored by combining this prompt's judgment with the richer (but previously dead) designs already drafted in `platform.ts` — they have not been reviewed by a product owner and should be treated as a reasonable first cut, not a final specification.

**P2**:
- `packages/shared-types/src/modules.js`'s `RELEASE_STAGE = "controlled-early-access"` is stale phrasing (confirmed zero runtime consumers) left unedited rather than guessed-and-changed without a clear replacement value or product sign-off.
- Auditing coverage to the central `audit_events` table for the new `module.status_changed` path was not re-verified beyond confirming the existing `audit()` call in the route was preserved.

**P3**:
- None of the 34 roles' descriptions have been reviewed for consistent tone/length against the pre-existing 26 (the 8 touched in this prompt were written to match the existing style, not audited against it).
- `pnpm release:verify` currently fails on a real, pre-existing `apps/landing` mobile-responsive CSS defect (horizontal overflow on `/` and `/book-demo` at several viewport widths, `tests/e2e/mobile-conversion.spec.ts`) — discovered while verifying this prompt, entirely unrelated to and outside the scope of authorization/module work (Section 19). Belongs to the separate landing-redesign initiative referenced in `CLAUDE.md`, not this 102-prompt ERP program's Prompt 5+.

## 18. Files Changed

**Modified**: `apps/mobile/src/core/modules/catalog.ts`, `apps/web/src/app/api/modules/[key]/route.ts`, `apps/web/src/lib/access-control.ts`, `apps/web/src/lib/platform.ts`, `apps/web/tests/enterprise-rbac.test.mjs`

**Added**: `apps/web/src/lib/module-access.ts`, `apps/web/tests/module-access.test.mjs`, `database/control-plane/migrations/027_role_catalogue_module_completion.sql`, `docs/implementation/ERP_AUTHORIZATION_MODEL_004.md` (this document)

(Files from Prompts 1-3 are unchanged by this prompt and are not re-listed; see their own reports for their file lists.)

## 19. Verification Results

| Command | Result |
|---|---|
| `pnpm verify:fast` | **PASS** |
| `pnpm typecheck:web` | **PASS** (clean; one stale generated `.next/dev/types/validator.ts` file from an earlier interrupted dev-server session was removed first — a gitignored build artifact, not source, unrelated to this prompt's changes) |
| `pnpm lint:web` | **PASS** (1 pre-existing, unrelated warning) |
| `apps/web` tests | **34/34 PASS** |
| `services/api` tests | **60/60 PASS** (unchanged from Prompt 3) |
| `pnpm verify:mobile` | **PASS** (typecheck + lint clean after the `catalog.ts` fix) |
| `pnpm verify:db` | **PASS** (0 failures; 1 pre-existing, unrelated warning — duplicate migration prefix `039`, not touched) |
| `pnpm verify` | **PASS** (full Level 5 composite, confirmed via a complete foreground run) |
| `pnpm release:verify` | **FAIL** — but not because of this prompt's changes. `verify`, `build:web`, `lint:landing`, `typecheck:landing`, `build:landing`, and `test:landing` (unit) all passed; `test:landing:e2e` failed 22/658 (636 passed) with a genuine, pre-existing `apps/landing` mobile-responsive CSS defect — real horizontal overflow (`scrollWidth 460 > clientWidth 375`) on `/` and `/book-demo` at multiple mobile/desktop viewport widths, plus 2 downstream visual-snapshot mismatches. Confirmed unrelated to this prompt: Prompt 4 did not modify any file under `apps/landing`, and the failing specs test marketing-site page width/layout, not anything module-access/authorization related. (Two earlier attempts at this same command also failed, but on a corrupted, gitignored `.next/dev/types/validator.ts` left over from an interrupted dev-server session reported by the user at the start of this prompt — cleaned from both `apps/web` and `apps/landing` before this final, code-accurate run; see git status for confirmation nothing under `.next/` was ever tracked or committed.) |

## 20. Addendum (post-Prompt-7): `organization_modules` stuck-disabled gap found and fixed

Reported by the user via a live sidebar screenshot (after Prompt 7) showing only CRM/Sales/Accounting/Procurement — exactly the original four-module launch cohort this document's Section 3/17 already covered for *roles*, but not for tenant module **enablement**. The first fix attempt (an `INSERT ... ON CONFLICT DO NOTHING` migration) was verified against the repository but not against a live database; querying the actual running local Postgres (`docker exec vercentlabs-postgres psql ...`) showed the real mechanism was different from the original hypothesis, corrected below.

**Root cause, confirmed live**: migration `009` (crm release) seeded a row for *every* organization across *all 12* catalogue modules in one pass — `crm` `'enabled'`, every other module explicitly `'disabled'` (correct at the time: only CRM was released). Migrations `012`/`013`/`014` (sales/accounting/procurement) each correctly flipped their own module's row to `'enabled'` for every existing org. Migrations `019`-`026` (stock, manufacturing, projects, assets, point-of-sale, quality, support, hr-payroll) correctly added each module's `permissions` rows but never performed the equivalent flip — each only ran `INSERT INTO permissions`. Migration `027` (Section 8/17) fixed the *role* side of this same eight-module cohort but didn't touch `organization_modules`. The rows from migration `009` were therefore never missing — they existed the whole time, stuck at `status='disabled', enabled_at=NULL`. That specific combination is otherwise unreachable through the app's own code: `PATCH /api/modules/[key]` never clears `enabled_at` when disabling an already-enabled module, so `enabled_at IS NULL` can only mean "never once enabled." Live query confirmed exactly 8 such rows in the whole database, all on the single oldest organization (created before any of these 8 modules existed — every other organization was created later, after `platform.ts`'s `seedOrganizationFoundation()` was already correctly seeding all 12 modules `'enabled'` for new orgs from day one).

**Fix**: `database/control-plane/migrations/028_organization_modules_backfill.sql`, two parts, both scoped to exactly the 8 affected modules: (1) `UPDATE organization_modules SET status='enabled', enabled_at=now() ... WHERE status='disabled' AND enabled_at IS NULL` — matches only a row in its pristine, never-touched post-009-seed state, so it can never override a module an administrator actually enabled-then-disabled; (2) `INSERT ... ON CONFLICT DO NOTHING` for the (empirically rarer, but theoretically possible) case of a row missing outright. Applied directly to the local dev database via `docker exec vercentlabs-postgres psql ... < 028_organization_modules_backfill.sql` (`UPDATE 8, INSERT 0` — matching the live diagnosis exactly) and verified the affected organization now shows all 12 modules `enabled`. Covered by an updated test in `apps/web/tests/module-access.test.mjs`. Verified: `verify:db` (28 control-plane migrations, transaction-wrapped, RLS-enforced) and the full `apps/web` test suite (145/145) both pass.

**Separately noted, not fixed**: `infrastructure/docker/Dockerfile.migration`'s `CMD` invokes `pnpm db:migrate:control`/`db:migrate:tenant`/`db:provision:runtime-role` and `COPY scripts/database scripts/database` — none of these scripts or that directory currently exist anywhere in the repository (confirmed by search), so this Dockerfile would fail to build as-is, and there is presently no scripted way to apply a new migration file to a database short of running it by hand (as done above). This is a real, separate infrastructure gap — flagged here rather than silently worked around, since fixing it is a larger scope decision (what should the runner look like, does it need a `schema_migrations` tracking table, etc.) than this bug fix.
