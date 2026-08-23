# ERP Module Enablement & Entitlement Enforcement at the Server Boundary (Prompt 5 of 102)

Date: 2026-08-09
Scope: retrofit Prompt 4's `resolveModuleAccess()` resolver (built but never called) into real server-side enforcement across all 12 business modules, at the narrowest reusable point per module — not by editing 279 individual route handlers. Preserve Prompt 3's record/field-level security untouched. Investigate (not necessarily fix) the billing-entitlement-vs-provisioning gap Prompt 4 documented. No navigation/sidebar/command-palette work.

Starting git state: branch `main`, all Prompt 1-4 work present and untouched. No commits made. No destructive git operations used.

---

## 1. Executive Summary

Prompt 4 built `apps/web/src/core/module-access.ts` — a correct, fail-closed `resolveModuleAccess(session, moduleId)` resolver composing product release status, tenant enablement, billing entitlement, and permission — but confirmed nothing called it. A user whose organization had disabled a module, or whose billing plan never included it, could still read and write that module's data through its existing routes; only the routes' ordinary per-user permission checks applied.

This prompt closes that gap by finding, for each of the 12 business modules, the **narrowest place that already gates every route in that module** and inserting one call to a new guard (`assertModuleAccessible` / `requireModuleWorkspace`) there — rather than touching every route body. Three distinct architectural patterns existed across the app, requiring three different (but consistent) wiring strategies:

1. **Group A — accounting, procurement, stock, sales (4 files, 85 routes).** These four modules already share one `*Session()` route-context builder per module (`accounting-route.ts`, `procurement-route.ts`, `stock-route.ts`, `sales-route.ts`). One call added to each.
2. **Group B — CRM (1 module, 99 routes across web + mobile-v1, plus 2 approval-workflow command handlers).** No single funnel existed — 91 web API route files and 19 mobile-v1 route files called a bare, synchronous `crmContext(session)` directly, with permission checks (`requirePermissionFromSession`, or one of four `crm-api.ts` helpers) scattered per-route. Fixed by adding an async `crmApiContext(session)` wrapper around the existing `crmContext()` and mechanically migrating every API-layer call site from `crmContext(session)` to `await crmApiContext(session)`.
3. **Group C — manufacturing, projects, assets, point-of-sale, quality, support, hr-payroll (7 modules, 29 routes).** No `*-route.ts` helper existed; every route called the module-agnostic `requireApiWorkspace()` directly. Fixed by adding `requireModuleWorkspace(moduleId)` (wraps `requireApiWorkspace()` + the same guard) and migrating all 29 call sites — which also required adding the try/catch + `errorResponse()` wrapping these 29 handlers were missing, since an uncaught `HttpError` would otherwise surface as a generic 500 instead of a diagnosable 403.

Total: **13 shared-helper files + 29 Group-C route files + ~99 CRM call sites + 1 approval-command file** changed, covering all 12 modules' primary read/write/dashboard/report/export paths, versus hand-editing 279 routes individually.

Denials are now diagnosable: `HttpError` gained an optional machine-readable `code` field, `errorResponse()` (already called by every route's catch block) surfaces it automatically, and every denial maps to one of `MODULE_NOT_AVAILABLE` / `MODULE_DISABLED` / `MODULE_NOT_ENTITLED` / `MODULE_NOT_PERMITTED`.

Two exception categories were identified and deliberately **not** touched, each documented rather than silently left inconsistent: the module enable/disable admin route (Part 6) and public/session-less CRM endpoints (lead capture, webhooks, booking, chat). See Section 8.

## 2. Why the Server Boundary Is the Route-Context Builder, Not `hasPermission()`

Three centralization points were evaluated before wiring began:

| Candidate | Why rejected / accepted |
|---|---|
| `apps/web/src/core/authorization.ts`'s `hasPermission()`/`requirePermissionFromSession()` | Rejected. These are synchronous and called from ~230 sites across both API routes **and** the 88 server-rendered `page.tsx` files (every module's page does `if (!hasPermission(session, PERMISSIONS.xView)) notFound();`). Making module resolution — which needs an `organization_modules` query and a billing-summary lookup — available synchronously would require precomputing and attaching it to `SessionContext` at session-load time (`resolveSessionContext()` in `auth.ts`), adding a DB round-trip to literally every authenticated request in the app (including ones with no module concept, like `/profile` or `/notifications`) and risking a circular import (`auth.ts` → `module-access.ts` → `authorization.ts` → `auth.ts`). Rejected as disproportionate blast radius for this prompt. |
| `services/api/src/<module>/index.js`'s local `requirePermission(context, permission)` helpers | Rejected as the *primary* enforcement point. These are synchronous, take a plain `context` object (not a live DB connection reference beyond what's already passed in), and are shared with the mobile API surface — but module/entitlement resolution needs an async DB+billing lookup, and these functions already have exactly one job (fine-grained action permission, e.g. "can this role approve a PO") that Prompt 3 hardened for HR/Support/Procurement. Mixing concerns here would risk the field-level regressions Prompt 3 fixed. Left untouched — they remain a valid second line of defense. |
| Each module's route-context builder (`accountingSession()`, `procurementContext()` builders, `requireApiWorkspace()`, `crmContext()`) | **Accepted.** Already async, already called before any business logic executes, already the place `write`-path billing metering (`requireBillingWriteAccess`/`incrementBillingUsage`) is centralized for Group A. Adding one more async call here is architecturally consistent with what's already there. |

## 3. New Primitives (`apps/web/src/core/module-access.ts`, `apps/web/src/core/http.ts`)

```ts
// module-access.ts — built on top of Prompt 4's resolveModuleAccess()
export async function assertModuleAccessible(session: WorkspaceSessionContext, moduleId: string): Promise<void>
export async function requireModuleWorkspace(moduleId: string): Promise<WorkspaceSessionContext>
```

`assertModuleAccessible` calls `resolveModuleAccess`; if `accessible` is `false` it throws `HttpError` with `status = 404` for `not_released` (roadmap modules — currently unreachable since all 12 are released, but keeps the mapping total) and `status = 403` for `disabled` / `not_entitled` / `not_permitted`, carrying a machine-readable `code`:

| `ModuleAccessReason` | HTTP status | `code` |
|---|---|---|
| `not_released` | 404 | `MODULE_NOT_AVAILABLE` |
| `disabled` | 403 | `MODULE_DISABLED` |
| `not_entitled` | 403 | `MODULE_NOT_ENTITLED` |
| `not_permitted` | 403 | `MODULE_NOT_PERMITTED` |

`requireModuleWorkspace(moduleId)` composes `requireApiWorkspace()` (existing session/org check) with `assertModuleAccessible` — the single call Group C's 29 routes now make instead of bare `requireApiWorkspace()`.

`HttpError` (`apps/web/src/core/http.ts`) gained a third, optional constructor argument (`code?: string`); `errorResponse()` — already the catch-block handler in effectively every route across the app — now calls a new `failWithCode()` that includes `code` in the JSON body when present. This means **every existing route's catch block automatically gained reason-code surfacing for free**, no per-route edit required, matching the "narrowest reusable point" principle applied one level further.

Both new guards inherit `resolveModuleAccess`'s existing fail-closed behavior (Prompt 4, Section "Can a system failure default to module access?") unchanged — a DB error resolving enablement or entitlement still resolves to `accessible: false`, never to a granted default.

## 4. Group A — accounting, procurement, stock, sales

| Module | File | Routes covered |
|---|---|---|
| Accounting | `apps/web/src/modules/accounting/server.ts` (`accountingSession`) | 60 |
| Procurement | `apps/web/src/modules/procurement/server.ts` (`procurementSession`) | 8 |
| Stock | `apps/web/src/modules/stock/server.ts` (`stockSession`) | 5 |
| Sales | `apps/web/src/modules/sales/server.ts` (`salesSession`) | 12 |

Each `*Session(write = false)` function gained one line immediately after its existing 401 guard:

```ts
const session = await getSessionContext();
if (!session?.organizationId) throw new HttpError(401, "Sign in to an organisation workspace.");
await assertModuleAccessible(session as WorkspaceSessionContext, "<moduleId>");
if (write) { /* unchanged billing-write metering */ }
```

The `write`-path billing checks (`requireBillingWriteAccess`, `incrementBillingUsage`) are unchanged and now run strictly after the module gate — a disabled/unentitled module is rejected before any billing-usage counter is incremented for it.

## 5. Group B — CRM

CRM had no single funnel: `crmContext(session)` was called synchronously and directly at 95 sites across 78 web-API route files, plus another 19 mobile-v1 route files, plus 2 server-rendered `page.tsx`-adjacent call sites inside the approval-command registry (`approval-commands.ts`) — and, separately, 14 actual `page.tsx` server components (Section 8). Permission gating before those calls was inconsistent: 18 files used shared helpers in `crm-api.ts` (`requireCrmView`/`requireCrmResourceView`/`requireCrmManage`/`requireCrmReportView`); the rest called `requirePermissionFromSession(session, PERMISSIONS.crmXxx)` inline.

Fix, in `apps/web/src/modules/crm/index.ts`:

```ts
export function crmContext(session: SessionContext): CrmContext { /* unchanged, still sync */ }

export async function crmApiContext(session: SessionContext): Promise<CrmContext> {
  await assertModuleAccessible(session as WorkspaceSessionContext, "crm");
  return crmContext(session);
}
```

Every API-layer call site was migrated mechanically (`crmContext(session)` → `await crmApiContext(session)`, `crmContext(s)` → `await crmApiContext(s)`, including the import statement) via a scoped, whole-word transform restricted to `apps/web/src/app/api/crm/**` and `apps/web/src/app/api/mobile/v1/**` — a path prefix that is structurally disjoint from `apps/web/src/app/(app)/**` (server-rendered pages), so the transform could not accidentally touch a page file. `apps/web/src/modules/crm/server/core-acceptance.ts` (the one CRM sub-area that already had its own `*Session()`-shaped helper, `crmCoreAcceptanceSession`, for the core-acceptance/quote-acceptance routes) was gated the same way as Group A. `apps/web/src/core/approvals.ts`'s two CRM command handlers (`crm.opportunity.stage_change`, `crm.activity.complete` — executed when an approval is finalized, still carrying a real actor session) were converted from sync arrow functions to async and migrated the same way.

99 routes covered: 91 web `route.ts` files under `app/api/crm/**` minus 11 public/webhook exceptions (Section 8) = 80, plus 19 mobile-v1 CRM route files = 99.

## 6. Group C — manufacturing, projects, assets, point-of-sale, quality, support, hr-payroll

| Module | Files | Routes |
|---|---|---|
| Manufacturing | `boms/[id]/activate`, `dashboard`, `resources/[resource]`, `work-orders/[id]/{production,release,start}` | 6 |
| Projects | `dashboard`, `resources/[resource]`, `projects/[id]/{actions,profitability}` | 4 |
| Assets | `assets/[id]/actions`, `dashboard`, `resources/[resource]` | 3 |
| Point of Sale | `dashboard`, `resources/[resource]`, `returns`, `sales/complete`, `shifts/[id]/actions` | 5 |
| Quality | `dashboard`, `inspections/[id]/actions`, `resources/[resource]` | 3 |
| Support | `dashboard`, `resources/[resource]`, `tickets/[id]/{actions,communications}` | 4 |
| HR & Payroll | `dashboard`, `resources/[resource]`, `leave-requests/[id]/actions`, `payroll-runs/[id]/actions` | 4 |

These 29 files previously called `requireApiWorkspace()` (module-agnostic: session + organization only) and — distinct from every other group — had **no try/catch at all**; an uncaught error of any kind (including the pre-existing plain `Error` `requireApiWorkspace()` already threw on a missing organization) surfaced as Next.js's generic 500, not a diagnosable status. Since a module-access denial is exactly the kind of new failure mode this prompt introduces, each of the 29 handlers was also wrapped in `try { ... } catch (error) { return errorResponse(error); }` in the same edit — otherwise `assertModuleAccessible`'s `HttpError(403, ..., "MODULE_DISABLED")` would have been thrown correctly but surfaced to the client as an undifferentiated 500, defeating the reason-code requirement for exactly this group.

```ts
// before
const session = await requireApiWorkspace();
// after
const session = await requireModuleWorkspace("manufacturing");
```//catch wrapping added around each handler body.

## 7. Coverage Matrix — All 12 Modules

| Module | Enforcement point | Routes gated | Verified by |
|---|---|---|---|
| CRM | `crmApiContext()` (+ `crmCoreAcceptanceSession()`) | 99 (+2 approval commands) | `module-enforcement.test.mjs` |
| Sales | `salesSession()` | 12 | `module-enforcement.test.mjs` |
| Accounting | `accountingSession()` | 60 | `module-enforcement.test.mjs` |
| Procurement | `procurementSession()` | 8 | `module-enforcement.test.mjs` |
| Stock | `stockSession()` | 5 | `module-enforcement.test.mjs` |
| Manufacturing | `requireModuleWorkspace("manufacturing")` | 6 | `module-enforcement.test.mjs` |
| Projects | `requireModuleWorkspace("projects")` | 4 | `module-enforcement.test.mjs` |
| Assets | `requireModuleWorkspace("assets")` | 3 | `module-enforcement.test.mjs` |
| Point of Sale | `requireModuleWorkspace("point-of-sale")` | 5 | `module-enforcement.test.mjs` |
| Quality | `requireModuleWorkspace("quality")` | 3 | `module-enforcement.test.mjs` |
| Support | `requireModuleWorkspace("support")` | 4 | `module-enforcement.test.mjs` |
| HR & Payroll | `requireModuleWorkspace("hr-payroll")` | 4 | `module-enforcement.test.mjs` |

**213 API routes gated in total** (99 + 12 + 60 + 8 + 5 + 6 + 4 + 3 + 5 + 3 + 4 + 4), plus 2 approval-workflow command handlers.

## 8. Exceptions — Deliberately Not Gated

**Admin: module enable/disable route** (`apps/web/src/app/api/modules/[key]/route.ts`). Gated by `requireApiPermission("modules.manage")` only, unchanged. Deliberately not passed through `resolveModuleAccess`/`assertModuleAccessible` against its own target module — an org administrator re-enabling a disabled module must not be locked out of the very action that re-enables it. Verified by `module-enforcement.test.mjs`'s "admin exception" test.

**Public/session-less CRM endpoints** (11 files: `crm/public/capture/[key]`, `crm/lead-acquisition/public/{forms,chat}/[key\|token]`, `crm/marketing/public/{events,surveys}/[token]`, `crm/public/meetings/**`, and the three inbound `webhooks/[provider]` routes). These have no user session — they resolve `organizationId` from a signed capture-form key, booking token, or webhook payload, and are already hardened by Prompt 3 (HMAC proxy-fingerprint verification, honeypot fields, origin allowlisting, tenant resolution strictly from the signed key/token, never a client-supplied identifier). `assertModuleAccessible` requires a `WorkspaceSessionContext`, which does not exist on this path. Two options existed: build a session-less, organization-ID-only variant (`getEnabledModuleKeys(organizationId)` alone, no session needed) to reject inbound leads/bookings/webhook events for a disabled CRM module, or leave the existing, carefully-tuned Prompt-3 hardening untouched. Given the ambiguity of the correct product behavior (should a paused module still passively capture inbound leads for later review, or reject them outright?) and the risk of regressing security-sensitive code this program has already hardened twice, **this prompt leaves these 11 routes unchanged** and records the question as a remaining gap (Section 10) rather than guessing at a product decision.

**Cross-module shared registries** (`apps/web/src/app/api/business-data/**`, `apps/web/src/app/api/settings/**`). `businessDataDefinitions` spans multiple modules' shared master data (parties, items, inventory setup, finance setup) by design — it is not owned by exactly one of the 12 modules, so gating it against a single `moduleId` would be architecturally wrong. Confirmed via reading `business-data.ts`'s resource registry; left untouched.

## 9. Investigation: Provisioning vs. Billing Entitlement (Prompt 4's Documented Gap)

Prompt 4's Section 17 flagged: `organization_modules` is seeded `status = 'enabled'` for every released module at org creation, regardless of the org's billing plan — so a Launch-plan organization (`billing_plans.modules = ["crm"]`) still has all 12 modules marked `'enabled'` in its own tenant registry.

**Finding: this prompt's enforcement closes the practical impact of that gap without needing to change provisioning.** `resolveModuleAccess` checks tenant enablement (`organization_modules.status`) and billing entitlement (`billing_plans.modules`) as two **independent** conditions, both required for `accessible: true`. A Launch-plan org's Accounting module now correctly resolves `enabled: true, entitled: false, accessible: false, reason: "not_entitled"` when `billingEnforcementMode() === "enforce"` (production) — the over-broad provisioning seed no longer translates into actual access, because entitlement is re-checked at every request, not assumed from the enablement flag alone.

What remains a genuine, if now low-severity, data-hygiene inconsistency: `organization_modules.status` will still read `'enabled'` for modules a plan never included, which is misleading to anyone reading that table directly (e.g., a future admin UI listing "your enabled modules" without also cross-referencing billing would show all 12 for a Launch-plan org). No code path was found that makes this decision without going through `resolveModuleAccess`/`getAccessibleModules`, so it is not a security gap — but fixing the provisioning seed to only mark plan-included modules `'enabled'` (or introducing a distinct "entitled-but-not-yet-enabled" provisioning state) is a product decision (does upgrading a plan auto-enable the newly-entitled modules, or require an explicit admin action?) outside this prompt's scope. Recorded here rather than fixed speculatively, matching Prompt 4's own precedent for undecided product questions.

## 10. Remaining Gaps

1. **Server-rendered CRM pages** (`apps/web/src/app/(app)/crm/**/page.tsx`, 14 files, plus `search/page.tsx`) still call the un-gated, synchronous `crmContext(session)` directly for their SSR data reads. Each already does its own `hasPermission(session, PERMISSIONS.crmView) → notFound()` check (an existing, app-wide convention shared by all 88 module page.tsx files, not CRM-specific), but none check module enablement/entitlement. A disabled-CRM organization's user could still load `/crm` and see a server-rendered dashboard with live data, even though every API route the page's client-side interactions call is now correctly gated. Deliberately out of scope: retrofitting this uniformly (88 page.tsx files across all 12 modules, not just CRM's 14) is a distinct, larger surface than "the server boundary" this prompt's title targets, and changing what a page shows for a disabled module is a UX/navigation design decision adjacent to the sidebar/navigation work this prompt explicitly excludes.
2. **Public/session-less CRM endpoints** do not check tenant module-enablement (Section 8) — a product decision, not an oversight.
3. **`organization_modules` over-seeding at provisioning** (Section 9) — cosmetic/data-hygiene, not a security gap post-enforcement, but not fixed here.
4. **Business-data/settings cross-module registries** are not module-gated by design (Section 8), meaning master-data reads/writes are not blocked by a module being disabled — consistent with treating them as shared platform data, not module-owned business data.

## 11. Tests

`apps/web/tests/module-enforcement.test.mjs` (21 new tests, static source-pattern verification — the same offline testing convention established in Prompt 4's `module-access.test.mjs`, since full behavioral coverage needs a live Postgres + billing fixture):

- Core primitives: `assertModuleAccessible` fail-closed shape, `REASON_CODES` completeness, `requireModuleWorkspace` composition, `HttpError`/`errorResponse` code plumbing.
- Group A: all 4 `*-route.ts` files call `assertModuleAccessible` with the correct `moduleId`.
- Group C: all 29 route files across all 7 modules call `requireModuleWorkspace` with the correct `moduleId`, zero stragglers on bare `requireApiWorkspace`, and each is verified to wrap its handler(s) in `try/catch` + `errorResponse`.
- CRM: `crmApiContext` shape verified; a repository-wide scan confirms no API route under `app/api/crm/**` or `app/api/mobile/v1/**` calls the unguarded `crmContext()`; the approval-command registry's 2 CRM mutations are confirmed migrated; CRM pages are confirmed to still use the sync `crmContext()` (documented gap, not a missed call site).
- Direct-bypass coverage for the modules Prompt 5 named explicitly (CRM, Accounting, Procurement, Manufacturing, HR & Payroll): confirms write-path routes cannot reach `services/api` business logic without first passing through a module-gated session helper.
- Admin exception: `modules/[key]/route.ts` confirmed permission-gated only, not self-referentially module-gated.
- Public exception: the 4 most security-sensitive public CRM endpoints (capture, lead-acquisition forms, two webhook providers) confirmed to remain session-less and untouched by the new guard.
- Entitlement-transition hygiene: Group C route files confirmed not to re-implement `organization_modules`/billing-summary lookups directly — `resolveModuleAccess` remains the single source of truth everywhere it was wired in.

All 58 tests in `apps/web/tests/` pass (37 pre-existing + 21 new), including Prompt 3's `public-capture-security.test.mjs` (unchanged, confirming no regression to the public-endpoint hardening this prompt's Section 8 relies on) and Prompt 4's `module-access.test.mjs`/`enterprise-rbac.test.mjs`.

## 12. Verification Results

| Command | Result |
|---|---|
| `pnpm --filter @vercentlabs/web typecheck` | PASS |
| `pnpm --filter @vercentlabs/web lint` | PASS (1 pre-existing, unrelated warning: unused `_request` param in `crm/marketing/attribution/route.ts`) |
| `pnpm --filter @vercentlabs/web test` | PASS — 58/58 |
| `pnpm verify:web` (typecheck + lint + test:web + test:api + verify:routes + build:web) | PASS — exit 0. `verify:routes` confirms 279 `route.ts` files (unchanged total, matching Prompt 1's audit), `test:api` confirms all 60 Prompt 3 field/record-level security tests still pass unmodified, `next build` compiled and generated all 162 pages successfully |

## 13. Adversarial Review

1. **Could a route reach `services/api` business logic while bypassing the new guard?** Checked every Group A/C file for the pre-migration `requireApiWorkspace`/direct `*Context()` construction pattern — zero stragglers (enforced by the test suite's "no bare requireApiWorkspace" assertion). CRM checked via a repository-wide scan for any remaining unguarded `crmContext(` call under the API surface — zero.
2. **Does the admin route lock itself out?** No — `modules/[key]/route.ts` is gated by `modules.manage` permission only, confirmed by both manual read and a dedicated test.
3. **Does `assertModuleAccessible` ever silently pass on an error instead of throwing?** No — it delegates entirely to `resolveModuleAccess`, which already fails closed (Prompt 4), and its own body has exactly one `return` (the accessible path) with every other path falling through to an unconditional `throw`.
4. **Did wrapping Group C's 29 handlers in try/catch change any *existing*, non-module-related error's status code?** Before this prompt, any error (validation, DB, or the module guard) in these 29 files surfaced as a generic 500 with no body shape guarantee. After, `errorResponse()` maps `HttpError` to its own status/code, `ZodError` to 400, and anything else still to 500 — matching the exact behavior every other module's routes already had. This is a strict improvement, not a behavior change requiring a compensating fix elsewhere.
5. **Could the CRM call-site migration have silently broken a file the sed pass matched incorrectly?** The transform was scoped by directory path (structurally disjoint from page routes) and by two literal, previously-verified call patterns (`crmContext(session)`, `crmContext(s)` — confirmed via a repo-wide grep for all distinct argument variable names before running the transform, finding only these two). `pnpm typecheck` passing across the whole app after the transform is strong independent confirmation no call site was left with a stale sync `crmContext` reference feeding a now-`Promise`-typed value, since that would be a type error, not a silent runtime bug.
6. **Does billing-write metering still run in the right order for Group A?** Yes — `assertModuleAccessible` runs before the `if (write)` block in all 4 files, so a disabled/unentitled module's write attempt is rejected before `incrementBillingUsage` runs, preventing usage-metering leakage for rejected requests.
7. **Was any Prompt 3 record/field-level security file touched?** No — `services/api/src/{crm,hr-payroll,support,procurement}.js`, `apps/web/src/core/security.ts`, and the public capture routes are unchanged by this prompt (confirmed via the file list in Section 14).

## 14. Files Changed

**New:**
- `apps/web/tests/module-enforcement.test.mjs`
- `docs/implementation/ERP_MODULE_ENFORCEMENT_005.md`

**Modified — core primitives:**
- `apps/web/src/core/module-access.ts` (added `assertModuleAccessible`, `requireModuleWorkspace`, `REASON_CODES`)
- `apps/web/src/core/http.ts` (added `HttpError.code`, `failWithCode`, wired into `errorResponse`)

**Modified — Group A (4):** `apps/web/src/lib/{accounting,procurement,stock,sales}-route.ts`

**Modified — CRM (Group B, ~101 files):** `apps/web/src/modules/crm/index.ts` (added `crmApiContext`), `apps/web/src/modules/crm/server/core-acceptance.ts`, `apps/web/src/core/approvals.ts`, 91 files under `apps/web/src/app/api/crm/**` minus the 11 public/webhook exceptions, 19 files under `apps/web/src/app/api/mobile/v1/**`.

**Modified — Group C (29):** all `route.ts` files under `apps/web/src/app/api/{manufacturing,projects,assets,point-of-sale,quality,support,hr-payroll}/**`.

**Unchanged (confirmed, not merely assumed):** every Prompt 3 deliverable; `services/api/src/**`; `packages/permissions/**`; the module/role catalogue from Prompt 4; the 11 public/webhook CRM routes; `business-data`/`settings` routes; the 88 server-rendered `page.tsx` files.
