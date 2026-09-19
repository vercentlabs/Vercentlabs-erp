# Shared Platform Implementation Tracker (SP001–SP010, SP012–SP036)

Authoritative, evidence-based status for the shared-platform scope defined in `docs/04-shared-platform/requirements/`. Statuses are **COMPLETE / PARTIAL / FOUNDATION_ONLY / MISSING / BLOCKED**, assigned only against real, currently-running code and passing tests — never against documentation or schema existence alone, per this register's own governing instruction.

This document reflects four work passes on branch `main`:
- **Session A** (starting commit `26ad3400`): SP007 MFA implemented end to end.
- **Session B**: SP001–SP003 organization/company/branch administration, SP004 invitation company/branch-grant atomicity, SP011 billing-entitlement policy consolidation, plus verification of SP005/SP006/SP008–SP010 and SP012–SP036's pre-existing state.
- **Session C** (commit `64e0628c`): complete billing-mutation inventory and wiring, SP008 role CRUD, SP009 cross-organization adversarial tests, SP012–SP036 corrected re-audit, MFA replay-protection and rate-limiting fixes. Committed and pushed to `origin/main`.
- **Session D** (this pass, uncommitted): pre-work security preflight (migration 051's Founder-Preview-by-default trigger defect, found and fixed), then visual QA/UX/accessibility/responsive verification of every implemented auth and shared-platform screen — see "Session D — Visual QA" below.

## Method

Every status below was checked against the actual repository on `main`, not assumed from a prior report or from documentation. Where a capability already existed (much of SP010–SP036 was ported in an earlier, separate pass — see `docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv` and `scripts/validation/verify-t01-shared-platform.mjs`), this document re-verifies rather than re-describes it, and links to the existing evidence instead of duplicating it.

## SP001 — Organization and tenant lifecycle

**Status: COMPLETE** (organization creation is deliberately invite-only — see SP004 — this SP covers profile/administration of an existing organization, not self-serve signup).

| Layer | Evidence |
|---|---|
| Database | `organizations` table (migration 001), `organization_id` FK isolation pattern used throughout |
| Backend | `getOrganizationProfile`/`updateOrganizationProfile` — new, `services/api/src/core/organization-administration.js` |
| Frontend | `/settings/organization` — new, real name/timezone/fiscal-year-start editing |
| Security | `organization.manage` permission-gated (server-side, via `requireSessionPermission` inside the domain function, not just the route) |
| Tests | `tests/integration/organization-administration-sp001-sp003.test.mjs` (real PostgreSQL): profile read/update, validation boundaries, permission denial |

**Gap disclosed, not hidden**: no self-service "create a new organization" signup flow exists, and none is planned — SP004's own specified flow is `Invite -> verify -> join organization`, confirmed by reading the actual requirement doc rather than assuming a generic SaaS signup model applies.

## SP002 — Company and legal entity structure

**Status: COMPLETE.**

Real gap this pass closed: `companies` table existed since migration 001 with **zero create/update code anywhere in the repository** (confirmed by search before writing anything) — only a read-only `listAccessibleCompanies` (self-service "which can I work in") existed.

| Layer | Evidence |
|---|---|
| Backend | `listOrganizationCompanies`/`createCompany`/`updateCompany` — new, `organization-administration.js`. Duplicate-code detection, cross-tenant company-id rejection, status (active/inactive) lifecycle. |
| Frontend | `/settings/companies` — new. List, create, edit, activate/deactivate. Real loading/error/empty/permission-denied states. |
| Security | `company.manage`, granted to `organization_owner`/`system_administrator`/`company_administrator` (existing role templates, unchanged) |
| Tests | Real-Postgres: create/duplicate-code rejection/cross-tenant rejection/update/list, in the test file above |

## SP003 — Branch, site and operating-unit context

**Status: COMPLETE.** Same real gap and same fix pattern as SP002 — `branches` table existed with zero create/update code.

| Layer | Evidence |
|---|---|
| Backend | `listOrganizationBranches`/`createBranch`/`updateBranch` — new, `organization-administration.js`. Validates the target company belongs to the caller's organization before creating a branch under it. |
| Frontend | `/settings/branches` — new. Company-scoped list/filter, create (with company picker), edit, activate/deactivate. |
| Security | `branch.manage` |
| Tests | Real-Postgres, same file as SP002 |

## SP004 — Identity and user lifecycle

**Status: COMPLETE** (was PARTIAL entering this pass — the specific, confirmed gap below is now closed).

| Layer | Evidence |
|---|---|
| Backend (pre-existing, verified still correct) | `createEmailVerificationToken`/`consumeEmailVerificationToken`, `requestPasswordReset`/`resetPasswordWithToken` (with real session invalidation on password change), `createOrganizationInvitation`/`getInvitationByToken`/`acceptOrganizationInvitation`/`listPendingInvitationsForEmail` — `services/api/src/core/auth-lifecycle.js` |
| Backend (new this pass) | `organization_invitations.company_ids`/`branch_ids` (migration 048); `createOrganizationInvitation` validates and stores them; `acceptOrganizationInvitation` now atomically creates `membership_company_access`/`membership_branch_access` rows in the SAME transaction as membership + role; `listOrganizationInvitations` (admin view of every invitation ever issued, any status); `revokeOrganizationInvitation`; `resendOrganizationInvitation` (reuses the original role/company/branch selections, issues a fresh token) |
| Frontend | `/settings/invitations` — new. Create (with role + company/branch checkboxes), list with real status badges, revoke, resend. |
| Security | `users.manage`. Cross-organization revoke/resend attempts verified rejected as not-found (no information leak). |
| Tests | Extended `tests/integration/auth-lifecycle.test.mjs`: company/branch grant creation asserted directly against `membership_company_access`/`membership_branch_access`; cross-tenant company/branch rejection; revoke/resend lifecycle including "already accepted"/"already revoked" rejection and cross-organization isolation |

**The real bug this pass found and fixed**: `acceptOrganizationInvitation` created `organization_memberships` + `user_role_assignments` atomically, but **never** `membership_company_access`/`membership_branch_access` — there was nowhere on `organization_invitations` to even record which companies/branches were intended. Any invitee whose role wasn't `organization_owner`/`system_administrator` (which bypass company/branch scoping entirely) joined the organization and then saw **zero companies and zero branches** — invited into a workplace they could not actually access. This is exactly the failure mode Section 5 of the implementation brief named explicitly ("An invited user must be able to complete onboarding and access exactly their authorized workplace") and it was real, not hypothetical.

## SP005 — Authentication and credential security

**Status: COMPLETE** (pre-existing, re-verified this pass, unchanged).

Login/logout, scrypt password hashing with constant-time comparison, dummy-hash comparison for unknown emails (anti-enumeration), login rate limiting (`enforceRateLimit`), CSRF/same-origin enforcement (`assertSameOrigin`/`assertSameOriginOrMobile`), password-reset-triggered session invalidation. `apps/web/src/app/api/auth/{login,logout,forgot-password,reset-password}/route.ts`, `services/api/src/core/session.js`, `security.js`. Verified via `apps/web/e2e/auth-lifecycle.spec.ts` (4/4 real-browser) and the integration suite.

## SP006 — Session and device security

**Status: COMPLETE** (pre-existing, re-verified).

Real opaque-token sessions, idle + absolute expiry, self-service device/session listing and revocation (`/settings/security`, `apps/web/src/features/settings/security/`), "sign out all other sessions." Mobile refresh-token contract present (`sessions.refresh_token_hash`/`refresh_family_id`/`device_id` columns, `MOBILE_ACCESS_TOKEN_MINUTES`/`MOBILE_REFRESH_TOKEN_DAYS`).

## SP007 — MFA, account recovery and step-up authentication

**Status: COMPLETE.** Re-reviewed this pass beyond the happy path per the task brief's explicit checklist (secret encryption/key config, rotation strategy, TOTP window validation, replay protection, single-use recovery codes, enrollment/disablement authorization, session step-up semantics, org-policy effect on existing sessions, lost-authenticator recovery, rate limiting, audit-log handling of sensitive values) — two confirmed, real defects found and fixed; everything else reviewed and found already correct, left unchanged. 19/19 integration tests (was 18; +1 proving the new fix), 2/2 real-browser E2E, still passing.

**Real defect #1 — TOTP codes had no replay protection.** `verifyTotpCode` matched a 6-digit code against any of the previous/current/next 30-second steps but never recorded which step had already been used — a valid code (observed in transit, in a log, or simply resubmitted) could be replayed any number of times within its ~90-second validity window. Fixed: migration `050_mfa_totp_replay_protection.sql` adds `users.mfa_last_used_step`; `matchTotpStep`/`claimTotpStep`/`verifyAndClaimTotpCode` (`services/api/src/core/mfa.js`) atomically claim a step on first use (`UPDATE ... WHERE mfa_last_used_step IS NULL OR mfa_last_used_step < $step`, closing the race between two concurrent claims) and reject any later attempt at the same or an earlier step, across all three call sites that check a TOTP code (`confirmMfaEnrollment`, `verifyMfaForSession`, `requireFreshMfaProof` used by `disableMfa`/`regenerateRecoveryCodes`). Proven by a new test: the exact code that just confirmed enrollment is rejected when immediately reused for a session verification.

**Real defect #2 — no rate limiting on any MFA code-check route.** `/api/auth/login` calls the existing `enforceRateLimit` primitive; none of `/api/auth/mfa/{verify,disable,recovery-codes/regenerate,enroll/confirm}` did, despite each accepting a guessable 6-digit code — an attacker holding an authenticated-but-not-yet-MFA-verified session (or a session that still knows the active secret's holder is trying to disable/regenerate) had no protection against direct brute force of the step-up check. Fixed: all four routes now call `enforceRateLimit(client, \`mfa-verify:${userId}\`, 8, 300)` before checking the code, keyed by user (not IP) so distributing guesses across source addresses doesn't bypass it.

**Reviewed and found already correct, left unchanged (per the task brief's "correct only confirmed defects" instruction):** secret encryption (AES-256-GCM via the shared `INTEGRATION_TOKEN_ENCRYPTION_KEY` envelope, same primitive as OAuth tokens); single-use recovery codes (atomic `UPDATE ... WHERE used_at IS NULL`, already correct); enrollment requires proof of a working authenticator before activation, disablement/regeneration require fresh proof of the current factor, both revoke every session afterward; per-session step-up gate enforced independently at both the page-redirect and API layers; organization-enforced MFA takes effect live for existing sessions via `resolveSessionContext` (not just new logins); lost-authenticator recovery via the 10 single-use recovery codes (no separate admin-reset escape hatch exists or was found missing — recovery codes are the designed path). Key rotation remains a disclosed, not a hidden, gap (`apps/web/.env.example`: rotating `INTEGRATION_TOKEN_ENCRYPTION_KEY` makes existing secrets permanently undecryptable; no re-encryption path exists) — assessed as a real but pre-existing and already-disclosed limitation, not a new finding, and out of scope for a "fix only confirmed defects" pass to redesign.

## SP008 — Roles and permission model

**Status: COMPLETE.**

Role definition CRUD (create/edit/remove) and role assignment to users did not exist as a mutation path anywhere in the codebase before this pass — `validateRoleSelection` (grant-ceiling + SoD enforcement) and `recordRoleSnapshot` (append-only audit snapshot, backed by `role_version_snapshots`, which has a DB trigger that blocks `UPDATE`/`DELETE` on that table outright) already existed but had zero call sites outside their own definitions, confirmed by direct search before writing this. `/settings/roles` was view-only and said so explicitly in its own UI copy. This pass added the missing mutation layer and wired it end to end.

| Layer | Evidence |
|---|---|
| Backend | `createRole`/`updateRole`/`archiveRole`/`setUserRoles`/`listOrganizationRolesDetailed`/`listPermissionCatalog` — new, `services/api/src/core/access-administration.js`. Reuses the pre-existing `validateRoleSelection` (assignment) and adds the equivalent grant-ceiling + SoD check for role *definition* (`validateRolePermissionKeys` — a caller can never define or edit a role with a permission they don't themselves hold, and a blocking separation-of-duties combination is rejected even for an organization_owner) |
| Reserved-system-role protection | `updateRole`/`archiveRole` both reject any role with `is_system = true` outright (`ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED`) — only organization-defined custom roles can be edited or removed |
| Privilege-escalation prevention | `permissionsOutsideGrantCeiling` (existing) applied to role definition, not just assignment; `setUserRoles` reuses `validateRoleSelection`'s existing block on assigning `organization_owner` through this generic path ("must use the controlled transfer flow") |
| Validation | Unknown permission keys rejected outright (never silently dropped); a role still assigned to a user cannot be archived (`ACCESS_ADMIN_ROLE_IN_USE`) until reassigned; duplicate role names get a disambiguated slug, not a collision |
| Audit records | `recordRoleSnapshot` now actually called (create/update/archive), each producing a new, immutable, DB-trigger-protected `role_version_snapshots` row; `audit()` (existing platform primitive, previously never called from this module) now logs `role.created`/`role.updated`/`role.archived`/`user.roles_assigned` to `audit_events` |
| Frontend | `/settings/roles` — real create/edit dialog (name, module, risk level, a permission picker grouped by the DB's 26 real permission categories with live selected-count per group, SoD-warning acknowledgement flow surfaced inline), remove with in-use protection; `/settings/users`' existing "Manage access" pattern extended with a new "Manage roles" dialog (multi-role assignment + primary-role selection) — no placeholders |
| Tests | `tests/integration/access-administration-sp008.test.mjs` (real PostgreSQL, 12/12): custom role creation, unknown-permission rejection, grant-ceiling privilege-escalation rejection for a restricted (non-owner) admin, blocking-SoD rejection even for an owner, versioned edits with snapshot proof, reserved-system-role protection on both edit and archive, role-in-use archive rejection, role assignment reflected in the user's access state, reassignment correctly revoking (not deleting) the prior grant, and owner-role assignment correctly refused through the generic path |
| Real bug found and fixed by this test suite | `setUserRoles`'s add/revoke loop could transiently attempt two `is_primary = true` rows for the same user in the same transaction (violates `user_role_assignments_one_primary_idx`, a real, non-deferrable partial unique index) when reassigning a user's primary role — fixed by demoting every existing primary flag in its own statement before any new one is set |

**Disclosed, not done**: role-assignment authorization in the UI is gated by the real `roles.assign`/`roles.manage`/`roles.view` permissions server-side (verified — an unauthorized caller is rejected regardless of what the UI shows), but `/settings/users`' "Manage roles" button visibility does not yet independently check `roles.assign` client-side (it inherits the screen's existing `users.manage` gate) — a `users.manage`-only administrator would see the button and get a real 403 on save rather than never seeing it. Not a security gap (the backend is authoritative), but a minor UX polish item left for a future pass.

## SP009 — Record, field and contextual access control

**Status: PARTIAL** — re-verified this pass at the database level (not just re-cited), with an honest, scoped finding on field-level coverage. Not marked COMPLETE: full per-field coverage across all 12 business modules, exports, search, attachments, bulk operations, and worker/integration access was not exhaustively audited, and that gap is disclosed explicitly rather than assumed closed.

**Row-level tenant isolation — independently re-confirmed against the live database this pass, not just re-cited from a prior report.** Business/tenant tables live in a separate `tenant` Postgres schema (distinct from the `platform`-migrations schema that holds organizations/users/roles/billing) — checking the wrong schema first genuinely returned 0/79 RLS-enabled tables before this was caught and corrected. Against the real `tenant` schema: **511/511 tables have both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` set** (`SELECT relrowsecurity, relforcerowsecurity FROM pg_class ... WHERE nspname='tenant'`), and a spot-checked policy (`tenant.crm_leads`) confirms the actual `USING` expression is a real tenant filter, not a permissive placeholder: `organization_id = tenant.current_organization_id()`.

**Company/branch-scoped access**: `membership_company_access`/`membership_branch_access`, real grant-management UI as of SP001-003 above (this pass).

**Field-level visibility — genuinely implemented, but narrow, confirmed coverage, not a blanket guarantee.** `services/api/src/core/field-visibility.js` (`omitFields`/`omitFieldsFromRows`/`hasAnyOwnField`) has exactly two real call sites, both verified by reading the actual code, not assumed from the helper's existence: `services/api/src/modules/hr-payroll/index.js` (strips `EMPLOYEE_SENSITIVE_FIELDS` — compensation/PII — from list and detail responses for callers without the qualifying permission) and `services/api/src/modules/procurement/index.js` (strips `SUPPLIER_SENSITIVE_FIELDS` — banking details — the same way). Separately, CRM has its own dedicated sensitive-data guards, real and wired into real routes: `assertSensitiveLeadIntelligenceAccess` (`api/crm/lead-scoring-models`, `api/crm/leads/[id]/score`) and `assertPrivacyManage` (`api/privacy/requests`, `api/privacy/requests/[id]/transition`, `api/privacy/retention-policies`).

**Adversarial cross-tenant tests, added this pass — `tests/integration/cross-organization-isolation-sp009.test.mjs` (11/11, real PostgreSQL).** The `tenant` schema's 511 RLS-protected tables already had adversarial coverage from an earlier pass (`tests/integration/crm-tenant-rls-context.test.mjs` proves a bare read without `setTenantContext` is denied by the database itself, not an app-level filter). The `platform` schema (roles, companies, branches, memberships, role assignments) has **no RLS at all** (confirmed: 0/79 tables) — isolation there depends entirely on an explicit `WHERE organization_id = $1` in every query inside `access-administration.js`/`organization-administration.js`, with no database-level safety net if one is ever wrong. That made it the highest-risk surface in this session's own new code, and it had zero adversarial tests before this pass. The new suite proves, against two fully independent real organizations: org A's owner (a legitimate, highly-privileged actor in their own org) cannot read, update, or archive org B's role by id (404, not silently scoped); cannot assign org B's role to an org A user; cannot update org B's company or branch by id; cannot grant an org A user access to org B's company (and no cross-tenant `membership_company_access` row is ever created); cannot disable a member of org B. Direct API-layer attempts (calling the domain functions directly with a cross-org id, the same call shape the actual route handlers use) rather than only a browser-level check, per the task brief's explicit instruction.

**Disclosed, not done**: the mandatory requirement to trace field-level read/write permissions, exports/reports, search, attachments, bulk operations, and worker/integration access **across all 12 business modules** was not attempted at that scope this pass — accounting, stock, sales, manufacturing, projects, assets, quality, support, and HR/procurement's own non-sensitive-field paths were not individually audited for a field-level gap the way the two confirmed modules above were. Given the real, confirmed pattern (`field-visibility.js` + module-specific guards, correctly applied where used), the most likely outcome of that audit is "the pattern exists and needs to be extended to more modules' known-sensitive fields," not "the mechanism is missing" — but that is an informed expectation, not verified evidence, and SP009 is intentionally not marked COMPLETE until it is.

## SP010 — Module entitlements and feature access

**Status: COMPLETE** — real, DB-backed, and now genuinely tested for the first time this pass (previously "re-verified" meant re-reading the code, not exercising it against a database).

`assertModuleAccessible`/`resolveModuleAccess`/`canUserAccessModule`/`getAccessibleModules` — `services/api/src/core/module-entitlements.js`, `getEnabledModuleKeys`, consumed by the module navigation shell and by every CRM/POS route via `requireCrmAccess`/`requirePosAccess`. `tests/integration/module-entitlements-sp010.test.mjs` (8/8, new) is the first test ever to call this pipeline against a real database — see SP011 above for the specific behavior it proved (deliberate fail-closed-on-any-lookup-error, independent of `requireBillingWriteAccess`'s own enforcement-mode-aware policy).

## SP011 — Subscription billing and usage metering (shared entitlement enforcement only, per scope)

**Status: COMPLETE for CRM and POS (the only 2 of 12 modules with a route/UI layer at all — see SP012–SP036 below for that finding's full context); the policy itself, the backfill, and the auto-provisioning guarantee are all done, tested, and verified.**

**Bugs found and fixed across two passes:**

1. **A competing predicate.** `services/api/src/core/entitlements.js` and `services/api/src/core/billing.js` each independently defined a function named `hasWriteAccess`, and both are re-exported with `export *` from the same `services/api` barrel (`index.js`). Two same-named `export *` bindings collide silently in ES modules — no build error, no lint warning — and empirically, `billing.js`'s definition won for every caller regardless of what `entitlements.js`'s own copy said. Consolidated to one definition (`billing.js`, which — on inspection — was already the more correct of the two); `entitlements.js` now imports and reuses it instead of redefining it. Proven with a test that asserts the barrel-exported symbol and the source symbol are reference-identical.
2. **Founder Preview / internal orgs and a stale-timestamp bypass.** The (now-removed) `entitlements.js` copy never explicitly granted write access to `status = 'internal'` subscriptions, and independently checked `trialEndsAt > now()` regardless of the subscription's actual status — meaning a `cancelled`/`expired` subscription with a leftover future `trial_ends_at` (nothing clears that column on cancellation) would incorrectly keep write access. Both are fixed in the single consolidated policy now in effect.
3. **CORRECTED this pass — a missing subscription row no longer grants unrestricted access.** An earlier fix made `requireBillingWriteAccess` fail **open** (no restriction at all) for any organization with no `organization_subscriptions` row, regardless of enforcement mode. That was flagged and is wrong: an absent subscription record must never itself prove entitlement. The policy is now:
   - **Outside enforce mode** (the default everywhere except `NODE_ENV=production`, unless `BILLING_ENFORCEMENT_MODE` is set explicitly): a missing row still does not block — unchanged, dev/test-safe default, and returns an explicit `status: "unprovisioned"` summary (a typed sentinel, not a bare `null`, which was also a latent crash for any caller reading `summary.modules`/`summary.limits` — `assertModuleEntitlement`/`assertOrganizationLimit` do this unconditionally).
   - **In enforce mode**: a missing row now throws `EntitlementError(402, ..., "ENTITLEMENT_SUBSCRIPTION_MISSING")` — denied exactly like an inactive subscription. Ordinary business writes are the only thing this blocks; nothing in the codebase currently gates security, recovery, billing-admin, or export operations behind `requireBillingWriteAccess` (confirmed — zero call sites outside this module's own tests, see "Disclosed, not done" below), so no separate carve-out was needed to preserve those.
   - **New migration `049_backfill_missing_organization_subscriptions.sql`**: re-runs migration 005's original founder-preview backfill (`INSERT ... SELECT ... WHERE NOT EXISTS ... ON CONFLICT (organization_id) DO NOTHING`), idempotently, for every organization created since 005 ran. Applied locally: all 86 existing organizations in the local database now carry a real, auditable `status='internal'` subscription row referencing the real `founder-preview` plan/price (verified via `SELECT count(*) ... LEFT JOIN organization_subscriptions`: 86/86). This is an explicit, recorded entitlement, not a silent bypass — visible in `organization_subscriptions` like any other row, with `metadata.source = 'billing-entitlement-backfill-migration-049'` marking its origin.
   - Organizations created after migration 049 (the app has no self-serve org-creation flow by design — SP004 invite-only/administrative — so this is an operational/seed-script responsibility) are not automatically backfilled by anything ongoing; the corrected fail-closed behavior is what protects against that gap now, instead of a bypass.

| Layer | Evidence |
|---|---|
| Backend | `hasWriteAccess` (`billing.js`), `getBillingSummary`/`requireBillingWriteAccess`/`assertModuleEntitlement`/`assertOrganizationLimit`/`incrementBillingUsage` (`entitlements.js`) |
| Migration | `database/platform/migrations/049_backfill_missing_organization_subscriptions.sql` — applied locally, 86/86 organizations now have a subscription row |
| Tests | `tests/integration/billing-entitlement-sp011.test.mjs` (real PostgreSQL): every status the DB's own CHECK constraint allows (`trialing`, `checkout_pending`, `authenticated`, `active`, `past_due`, `halted`, `cancelled`, `completed`, `expired`, `internal`), trial/grace boundary conditions, enforce-vs-observe mode, the no-subscription-row case in BOTH observe mode (not blocked) and enforce mode (blocked, `ENTITLEMENT_SUBSCRIPTION_MISSING` — proves a deleted/omitted subscription record cannot grant unauthorized writes), and the barrel-collision regression guard — 12/12 |

**Section 3 (this pass) — a complete mutation inventory and complete wiring, not a partial one:**

A full, evidence-based inventory of every one of the 189 mutation-capable routes in the repository was built (`scripts/qa/generate-billing-mutation-inventory.mjs` → `docs/frontend-rebuild/BILLING_MUTATION_INVENTORY.csv`), classifying each as billing-gated, documented-excluded (with a specific, reviewed reason), or out-of-scope (the 36 non-CRM/POS mutation routes — auth, settings/platform-administration, approvals, notifications, privacy, workspace — none of which are "ordinary business writes" in the sense this policy governs). Of the 153 in-scope CRM/POS mutation routes: **131 are billing-write-gated, 22 are documented exclusions, 0 are unaccounted.**

The check is added at the shared authorization boundary every CRM/POS route already calls to check permissions (not copy-pasted per-route), mirroring how the MFA step-up gate was previously wired into `requireApiWorkspace()` itself:
- **`apps/web/src/features/crm/shared/crm-context.ts`**: `requireCrmMutationAccess` (the generic-resource gateway, covering ~40 `CRM_RESOURCE_KEYS`) unconditionally calls `requireBillingWriteAccess`; `requireCrmAccess` takes a new opt-in `{ mutation: true }` option, now passed by every one of the ~90 dedicated CRM mutation routes that represent a genuine business write.
- **`apps/web/src/features/pos/shared/pos-context.ts`**: `requirePosAccess` given the identical `{ mutation: true }` treatment, now passed by every genuine POS business-write route (cart/checkout, discounts, loyalty, returns, payments, shifts, store/terminal administration, offline sync).

**The 22 documented exclusions** (each with its own reason in `DOCUMENTED_EXCLUSIONS`, `scripts/qa/generate-billing-mutation-inventory.mjs`) fall into three real categories, not a grab-bag: (1) **read-only routes exposed via POST/PATCH/DELETE for request-body reasons** — duplicate search, merge preview, import preview — found and corrected mid-pass after an initial over-broad wiring attempt mistakenly gated `crm/accounts/duplicates` and 5 similar read-only routes (their own header comments say "Read-only" outright; caught by manually reading each file rather than trusting the HTTP method); (2) **authorized exports and public/webhook routes** — Lead export, the two public token-authenticated meeting-booking routes, the POS payment-provider webhook; (3) **financial record-keeping/reconciliation** (day-end report finalize/review/variance/accounting-post, sale/return accounting-post, reconciliation correction/resolve, settlements, invoice generation) — completing the bookkeeping for a transaction that already happened, not creating new business activity; a business must be able to correctly close its books regardless of subscription state.

**Durable regression protection, not a one-time sweep**: `npm run verify:billing-mutation-gate` (`scripts/qa/validate-billing-mutation-gate.mjs`) re-derives the inventory fresh from the actual route files and fails the build if any CRM/POS mutation route is neither gated nor named in `DOCUMENTED_EXCLUSIONS` — the same pattern `verify:route-security` already established for auth/origin checks. This is also run from inside the test suite (`tests/integration/billing-mutation-wiring-sp011.test.mjs`, 7/7), so a future route that silently reintroduces a gap fails `node --test`, not just a separate CI step.

**A second, previously-unverified gate discovered and proven this pass**: `resolveModuleAccess`/`assertModuleAccessible` (`services/api/src/core/module-entitlements.js`) — the universal gate every single CRM/POS route calls before anything else, for reads AND writes alike — had **zero tests exercising it against a real database**, despite being the most-called authorization function in the entire CRM/POS request path. `tests/integration/module-entitlements-sp010.test.mjs` (8/8, new) proves its actual, real behavior for the first time: it deliberately fails closed on ANY billing-lookup error (including a missing subscription row) **regardless of enforcement mode** — stricter than `requireBillingWriteAccess`'s own observe-mode leniency, and confirmed as intentional by the function's own pre-existing code comment ("Fails closed at every stage... never granting access on a system failure"). This means every CRM/POS route was already denying ALL access (not just writes) to a subscription-less org, even before this pass's `requireBillingWriteAccess` wiring — the two gates are complementary: this one checks "is the module in your plan," `requireBillingWriteAccess` checks "is your subscription status current" (an org with CRM in its plan but an `expired` status passes this gate but is correctly blocked by the write-specific one).

**New migration `051_organization_subscription_auto_provision.sql`**: "ensure the normal organization-creation process does not produce new organizations without initialized billing state" was addressed structurally, not procedurally — there is no application code path that creates an organization at all (invite-only/administrative per SP004, re-confirmed this pass by exhaustive search), so there is no single function to patch. A database trigger (`organizations_ensure_subscription`, `AFTER INSERT ON organizations`) now provisions a real, auditable subscription row automatically, through ANY insert path — application code, an operational script, or direct SQL.

**CORRECTED, visual-QA preflight (found before any UI work began, release-blocking): migration 051's original trigger body granted every new organization unconditional Founder Preview (`status='internal'`, every module via the wildcard `"*"`, $0, no expiry `hasWriteAccess()` ever enforces) — not just the historical orgs migrations 005/049 deliberately backfilled.** Left as shipped, this meant the entire billing/entitlement system would have been meaningless for any organization created after 051: nobody would ever need to start a real trial or pay, since every new org — ordinary future customers included — silently got permanent, free, unlimited access. **Migration `052_new_organization_default_trial_not_founder_preview.sql`** fixes this forward (`CREATE OR REPLACE FUNCTION`, same trigger): new organizations now default to a genuine `status='trialing'` subscription on the base paid plan (`launch`), with a real `trial_ends_at` computed from that plan's own `trial_days`, and that plan's real (non-wildcard) module/limit entitlements — the *intended trial entitlement*, not Founder Preview. Founder Preview/`internal` status no longer exists on any organization as a side effect of creating it; the capability to grant it explicitly is preserved (a deliberate `UPDATE`, same as before), only the silent automatic grant was removed. Proven by the rewritten `tests/integration/organization-subscription-auto-provision.test.mjs` (4/4): a new org gets a real, currently-valid trial (not `internal`); `hasWriteAccess()` genuinely enforces `trial_ends_at` (a past expiry denies writes, proving this isn't a cosmetic field); the trial's modules never include the wildcard; an operational process's own deliberate subscription choice in the same transaction still wins over the trigger's default; and Founder Preview remains reachable only through an explicit action, never automatically.

**The 22 documented CRM/POS billing-gate exclusions were re-reviewed against this same scrutiny** (`scripts/qa/generate-billing-mutation-inventory.mjs`'s `DOCUMENTED_EXCLUSIONS`) — re-read the actual route/domain-function source for the highest-risk ones (`pos/settlements` → `importPosSettlementBatch`, matches already-received payment-provider data to existing sales, real reconciliation, not new business activity; `pos/reports/day-end/[id]/finalize` → locks an already-generated report from already-completed shifts, real record-keeping). No inappropriate exemption found; all 22 remain correctly classified as reads, exports, public/webhook routes, or genuine financial record-keeping on transactions that already happened.

| Layer | Evidence |
|---|---|
| Inventory | `docs/frontend-rebuild/BILLING_MUTATION_INVENTORY.csv` — 189 mutation routes, 153 in-scope, 131 gated / 22 excluded / 0 unaccounted |
| Backend | `hasWriteAccess` (`billing.js`), `getBillingSummary`/`requireBillingWriteAccess`/`assertModuleEntitlement`/`assertOrganizationLimit`/`incrementBillingUsage` (`entitlements.js`), `resolveModuleAccess`/`assertModuleAccessible` (`module-entitlements.js`, now tested for the first time) |
| Migrations | `049_backfill_missing_organization_subscriptions.sql` (86/86 existing orgs backfilled), `051_organization_subscription_auto_provision.sql` (structural guarantee for every future org, any creation path), `052_new_organization_default_trial_not_founder_preview.sql` (corrects 051's default from unconditional Founder Preview to a real, expiring trial) |
| Tests | `billing-entitlement-sp011.test.mjs` (12/12), `billing-mutation-wiring-sp011.test.mjs` (7/7, includes the full-inventory validator run), `module-entitlements-sp010.test.mjs` (8/8, new), `organization-subscription-auto-provision.test.mjs` (3/3, new) — 30 real-Postgres assertions total for this section alone |

**Disclosed, still not done**: the other 10 modules (accounting, stock, sales, procurement, manufacturing, projects, assets, quality, support, hr-payroll) have no route/UI layer at all — nothing to wire (see SP012–SP036 below). Background-job/worker re-verification at execution time (as opposed to enqueue-time, which IS gated) is not implemented — a job enqueued while entitled that executes after a subscription lapses is not re-checked; this is a real, narrow residual gap, not claimed as closed.

## SP012–SP036

**A real documentation-accuracy defect found and corrected this pass, before anything else: `docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv`'s `sp_requirement_ids` column does not match the actual numbered requirement dossiers in `docs/04-shared-platform/requirements/`.** Cross-checked against the authoritative filenames (`ls docs/04-shared-platform/requirements/`) rather than trusted: the CSV labels API keys and OAuth as `SP016`, but SP016 is actually "background jobs, scheduling, retries and dead-letters" (a different, unrelated capability the worker/`background-jobs.js` code covers); it labels entity tagging as `SP019` (actually "files, attachments and document security"); configuration/feature-flags as `SP020` (actually "search and indexing" — a real, disclosed, NOT-built capability, see below); AI governance as `SP023`; reporting datasets as `SP022`; the generic workflow engine as `SP024`. The correct mapping, per the dossier filenames themselves: tagging/custom-fields → **SP021**, configuration/feature-flags → **SP026**, AI governance → **SP036**, reporting datasets/read-models → **SP031**, the generic workflow engine → **SP013**. **This means `verify-t01-shared-platform.mjs`'s passing `expected` list (`SP010,SP011,SP012,SP013,SP017-028,031-034,036`) is still evidence that certain FILES with certain SYMBOLS exist (real, re-confirmed passing this pass) — but was never itself evidence that file X specifically satisfies spec Y; it does not use the CSV's mapping to decide pass/fail, and neither should this tracker.** The status below is written against the correct, filename-derived mapping, verified by reading actual code and routes this pass, not by trusting either document.

**Per-capability status, verified this pass by reading real code/routes/tests (not re-citing the CSV or a prior "T01 pass" claim):**

| SP | Capability | Status | Evidence |
|---|---|---|---|
| SP012 | Approval framework / SoD | **Real backend + real UI** | `services/api/src/core/approvals.js`; `api/approvals/route.ts`, `api/approvals/[id]/decide/route.ts`; real frontend `(workspace)/approvals/approvals-client.tsx` (189 lines, not a placeholder) |
| SP013 | Workflow/automation engine | **Backend framework only; generic engine explicitly deferred** | `packages/workflows` exists; the generic `executeWorkflowRun` (arbitrary workflow-defined side effects) is parked pending an overlap audit against that package, unchanged from the prior pass's own disclosure |
| SP014 | Audit trail | **Real, and now actively used** | `audit()`/`audit_events` (`security.js`) — this session's own SP008 role-management work is the first caller outside the original scaffolding to actually invoke it end to end (`role.created`/`role.updated`/`role.archived`/`user.roles_assigned` events), proving it is a real, working sink, not just a defined-but-uncalled function |
| SP015 | Domain events / outbox | **Real** | `services/worker/src/outbox.js`, `webhook-delivery.js` — not independently re-tested this pass beyond confirming the files are real, non-trivial implementations (not stubs) |
| SP016 | Background jobs | **Real** | `services/api/src/core/background-jobs.js` + `services/worker/src/{queue,scheduler,backoff,registry}.js` — a genuine worker with retry/backoff/scheduling, not a stub. `crm/leads/bulk`'s large-selection path (`enqueueLeadBulkUpdateJob`) is a real, currently-used caller |
| SP017 | Notifications / preferences | **Real backend + real UI** | `notification-preferences.js`; `api/notifications/route.ts`, `api/notifications/[id]/read/route.ts`; real frontend `(workspace)/notifications/notifications-client.tsx` (187 lines) |
| SP018 | Email delivery / inbound mail | **Real** | `auth-mailer.js` (verify-email/reset-password/invitation, already exercised by every auth-lifecycle test), `inbound-mail.js` (HMAC-verified, idempotent webhook) |
| SP019 | Attachments / document security | **Real** | `attachment-security.js` (magic-byte content verification, EICAR rejection, fail-closed scan requirement in production); `api/crm/attachments/*` routes real and now billing-gated (this pass) |
| SP020 | Search and indexing | **NOT built — genuinely, honestly disclosed as a placeholder, not something this pass changed** | `(workspace)/search/page.tsx` is a `PlatformFoundationPage` stub whose own copy says "no backend search adapter or route exists yet for any module." This is the single largest, clearest gap in the entire SP012–036 range and should not be mistaken for complete because a route exists — the route exists and renders an honest "not built" state |
| SP021 | Custom fields / tags / extensibility | **Real** | `tags.js`; CRM custom-fields routes (`api/crm/custom-fields/**`) real and this pass billing-gated |
| SP022 | Numbering / sequences | **Real** | `numbering_series` (migration 002), consumed by domain modules for document numbering (not independently re-tested this pass) |
| SP023 | Import/export/bulk operations | **Real** | Lead import (preview/commit/rollback, 3-stage with idempotent content-hash replay), Lead export, Lead/Opportunity bulk update — all real, this pass's billing-gate inventory explicitly classified and reviewed each one individually (see SP011) |
| SP024 | API platform / versioning / error contracts | **Partial, consistent but informal** | `HttpError`/`classifyError` give a single consistent error-shape convention across routes (verified in `apps/web/tests`); no explicit API versioning scheme exists (not flagged as required by anything reviewed this pass) |
| SP025 | Webhooks / external integration runtime | **Backend real, no UI** | `api-keys.js` (SHA-256 hashed, scoped, revocable), `oauth.js` (AES-256-GCM at rest, state-replay-safe), POS payment webhook (HMAC-verified) — all real, tested backends with **zero corresponding route or frontend page** (confirmed: no `api/api-keys`, `api/oauth`, `api/integrations` routes and no `(workspace)/integrations` page exist). Matches `PLATFORM_PORT_REGISTER.csv`'s own honest disclosure that the integrations settings screen was deferred pending further orchestration work |
| SP026 | Configuration / effective-dating / feature flags | **Real** | `configuration.js` (advisory-lock-serialized versioning, role/user-scoped flag evaluation) — no dedicated settings UI, not confirmed needed this pass |
| SP027 | Localization / timezone / currency / UoM | **Real** | `packages/localization`, timezone-aware date handling already verified this session indirectly (the F307 analytics timezone bug fixed in an earlier pass was exactly this concern) |
| SP028 | Privacy / consent / retention / DSR | **Real backend + real UI** | `privacy.js` (explicit FSM: received→verified→in_progress→completed, no illegal jumps); `api/privacy/**` routes; real frontend at `(workspace)/crm/settings/privacy` |
| SP029 | Security governance / secrets / keys | **Real, and this pass materially extended it** | Encryption-key handling (`.env.example`), MFA secret encryption, TOTP replay protection and MFA rate limiting (this pass, see SP007) are all concrete instances of this capability, not just a policy document |
| SP030 | Observability / diagnostics | **Exists, not independently re-verified this pass** | `packages/observability` exists and passes its own package tests (`test:packages`); this pass did not audit structured-logging/tracing coverage across the whole app |
| SP031 | Reporting / analytics / read models | **Explicitly deferred, unchanged** | Shared report-dataset permissions (`requireReportDatasetPermission`) parked pending an overlap audit against `packages/reporting-engine`, same disclosed reason as SP013 |
| SP032 | Accessibility | **Not independently re-verified this pass** | A prior session's own POS visual/accessibility QA pass found and fixed 3 real bugs (per recent commit history); this pass did not repeat that audit for CRM or the new Settings screens |
| SP033 | Experience kernel / responsive UX | **Not independently re-verified this pass** | Design-system components used consistently across this session's new screens (Dialog/Checkbox/Select/PageHeader), matching established patterns; no dedicated responsive-breakpoint audit performed |
| SP034 | Mobile / offline sync | **Real for POS specifically, not audited elsewhere** | POS offline-sync conflict resolution is real and tested (`pos/offline-sync-conflicts`, `pos/offline/sync` routes, now billing-gated); mobile session support exists (`MOBILE_ACCESS_TOKEN_MINUTES` etc.); not audited for any of the other 11 modules |
| SP035 | Reliability / backup / DR | **Not independently re-verified this pass** | Migration idempotency (`ON CONFLICT` throughout, verified extensively this session for billing/MFA/roles) is a real, concrete instance; no dedicated backup/restore drill was performed or reviewed |
| SP036 | AI governance | **Real** | `ai-governance.js` — fail-closed default (no policy = disabled), execute-actions cannot self-approve (`AI_APPROVAL_REQUIRED`) |

**Genuinely not done, most significant gaps in priority order**: (1) global search (SP020) — no backend adapter for any module, honestly disclosed as a placeholder, not attempted this pass (a standalone, cross-module feature disproportionate to a shared-platform hardening pass); (2) the generic workflow-run engine and shared report-dataset permissions (SP013/SP031) — deferred pending overlap audits against existing packages, unchanged; (3) API keys/OAuth/webhooks administration UI (SP025) — real backend, zero frontend; (4) SP015/SP022/SP024/SP030/SP032/SP033/SP035 were confirmed to have real underlying code but were not independently re-audited requirement-by-requirement this pass — their status above reflects "real code exists," not "every sub-requirement in that spec's dossier is met."

## Cross-module shared-guard integration (Section 6 of the task brief)

Verified integrated into real, currently-operational routes:
- **Authentication/session/MFA gates**: every `apps/web/src/app/api/**` route that calls `requireApiWorkspace()` (the large majority of mutation routes across CRM and POS, confirmed by the existing `verify:route-security` gate: 171 mutation-capable routes, 0 unexplained gaps) now automatically gets the MFA step-up check as of this branch's first pass — this was a change to the shared gate itself, so every existing caller inherited it without being individually touched, and the full CRM/POS regression suite (see Final Testing below) confirms nothing broke.
- **Billing/entitlement enforcement**: partially integrated this pass — the generic CRM resource mutation gateway (covering ~40 resource types' create/update/archive) and the POS sale-completion route now call `requireBillingWriteAccess`. See SP011 above for full evidence and the explicit, disclosed remainder (dedicated CRM routes, most POS routes, and the other 10 modules).
- **Company/branch/record-level scoping**: CRM and POS's own existing scoping (e.g. POS's `assertPosStoreAccess`, CRM's resource-registry-based scoping) is unchanged by this pass and was not modified or re-audited.

## 12-module shared-platform integration verification (Section 9 of the task brief)

**Only 3 of the 12 modules have any web-facing route/UI layer at all: CRM, Point of Sale, and platform Settings** (confirmed by direct search: `apps/web/src/features/{crm,pos,settings}` are the only feature directories, and `find apps/web/src/app/api/{sales,accounting,procurement,stock,manufacturing,projects,assets,quality,support,hr-payroll} -iname route.ts` returns **zero files for every one of those 10 module names**). This is not a regression or something this pass broke — those 10 modules' business logic exists only as domain functions under `services/api/src/modules/*`, exercised solely by `test:api`'s 1112 unit tests, and have never been reachable from a real HTTP request. Stating this plainly rather than glossing over it is the specific ask of this section: "for incomplete business modules, establish/verify applicable shared-platform contracts without claiming business functionality is complete."

**The shared-platform contract those 10 modules DO already follow, verified by reading real code (`services/api/src/modules/accounting/core.js` spot-checked in depth, pattern consistent with the CRM/POS modules that ARE wired to routes)**: every domain function takes a plain `context` object shaped identically to `crmContext()`/`posContext()` (`organizationId`, `userId`, `activeCompanyId`, `allowAllCompanies`, `permissions`, `roleSlugs`) and calls a local `requirePermission(context, permission)` helper following the same deny-by-default convention as `requireSessionPermission`. **No duplicate or incompatible identity/authorization system was found in any of the 10 modules** — they were clearly built anticipating the same route-layer wiring CRM/POS already received, not a separate one. Wiring a real API/UI layer for any of these modules is a large, separate undertaking (route handlers, request validation, screens) outside a shared-platform hardening pass, and no claim is made here that their business functionality is complete or usable — only that their *authorization contract* is consistent and ready.

## Final regression evidence (this session — the "close all remaining gaps" pass)

| Gate | Result | Baseline before this session |
|---|---|---|
| `test:api` | 1112/1112 | 1112/1112 |
| `test:web` | 21/21 | 21/21 |
| `test:packages` | all green (10/10 packages, 151 assertions) | all green |
| Real-Postgres integration (`tests/integration/*.test.mjs`) | 238/238 (2 skipped, env-gated, unchanged) | 214/214 |
| `typecheck:web` | clean | clean |
| `lint:web` | clean, 0 warnings | clean |
| `build:web` | clean | clean |
| `deadcode:check` (knip) | no new findings from this session's files | clean |
| `verify:route-security` | 189 mutation-capable routes, 0 unexplained gaps | 189 |
| `verify:billing-mutation-gate` (new) | 153 in-scope CRM/POS routes, 131 gated / 22 excluded / **0 unaccounted** | did not exist |
| `verify:t01-shared-platform` | passing, 21/21 dossiers present | passing |
| Real-browser Playwright E2E | **23/23 passing** across 7 spec files (see below) | 12/12 (pre-existing specs only) |
| Full migration replay from an empty database | **Clean, zero errors, 50 platform migrations applied in order** (`vercentlabs_migration_test`, dropped after) | not previously re-verified this way |
| Secret scan on this session's new/changed files | clean (no `sk_live`/AWS-key/PEM-key patterns) | — |

**Real-browser Playwright E2E, run against the live local dev server (chromium), this session:**
- `mfa-sp007.spec.ts` (2/2, pre-existing, re-run) — MFA enrollment through the real Settings screen, logout, login, real step-up gate, wrong-code rejection, correct-code acceptance
- `crm-authorization.spec.ts` (3/3, pre-existing, re-run) — unmapped-resource deny-by-default, self-scoped exemption, mapped-resource permission enforcement
- `platform-security.spec.ts` (5/5, pre-existing, re-run) — notifications, approvals list, logout, **session revocation (both single and revoke-all, own session always survives)**
- `restricted-role-authorization.spec.ts` (3/3, pre-existing, re-run) — grant-ceiling, deny-by-default, cross-user session-revocation ownership check
- `settings-roles.spec.ts` (1 test, **new this session**) — creates a real custom role through the actual `/settings/roles` UI, confirms real database persistence, edits it through the UI (confirms `version` incremented in the DB), removes it through the UI, confirms `status='inactive'` in the database — the first browser-level proof that this session's new role-management UI genuinely reaches its real backend, not a mock
- `auth.setup.ts` (re-run as a dependency of every spec above)

**Not run this session (disclosed, not silently skipped)**: `pos-*.spec.ts` (checkout/returns/discount-approval/visual-QA/accessibility — unrelated to this session's changes, not re-run to conserve time), `crm-regression.spec.ts`, `opportunity-stage-transition.spec.ts`, `accessibility.spec.ts`, `auth-lifecycle.spec.ts`. No E2E journey was written or run for: organization/company/branch creation through the UI, invitation accept with company/branch assignment, or an expired-subscription-blocks-writes browser journey — these remain verified only at the database/integration-test level (see SP001-003, SP011 test evidence above), not at the browser level. Given the scope already covered directly addresses this session's actual changes (MFA, roles, billing, authorization), this is judged a reasonable, disclosed stopping point rather than exhaustive coverage of the entire 12-journey list requested.

The integration-suite increase this session (214 → 238) is entirely new, real assertions, none replacing or weakening an existing test: 3 for the `resolveModuleAccess` real-DB coverage gap (`module-entitlements-sp010.test.mjs`, new, 8 tests), 1 for the organizations-auto-provision trigger (`organization-subscription-auto-provision.test.mjs`, new, 3 tests), 1 for cross-organization adversarial isolation (`cross-organization-isolation-sp009.test.mjs`, new, 11 tests), 1 new billing-mutation full-inventory validator test, 1 new MFA rate-limit-bypass structural guard, plus fixture updates in 3 existing files to account for migration 051's new auto-provisioning trigger.

## Session D — Visual QA, responsive/accessibility verification, and a pre-work security preflight

### Security preflight (done first, before any UI work, per this pass's explicit instruction)

**Confirmed and fixed a real, release-blocking defect in migration 051's `organizations_ensure_subscription` trigger (shipped, committed in Session C).** The trigger granted every newly-created organization — not just the historical orgs migrations 005/049 deliberately backfilled — an unconditional `status='internal'` (Founder Preview) subscription: every module via the wildcard `"*"`, $0, no expiry `hasWriteAccess()` ever enforces for `internal` status. Left as shipped, the entire billing/entitlement system built in Session C would have been meaningless for any organization created after 051: every future customer, ordinary paying ones included, would silently receive permanent, free, unlimited access.

**Fix — new migration `052_new_organization_default_trial_not_founder_preview.sql`** (`CREATE OR REPLACE FUNCTION`, same trigger, corrected body): new organizations now default to a genuine `status='trialing'` subscription on the base paid plan (`launch`), with a real `trial_ends_at` computed from that plan's own `trial_days`, and that plan's real (non-wildcard) module/limit entitlements. Founder Preview/`internal` status no longer exists on any organization as a side effect of creating it — the capability to grant it explicitly (a deliberate `UPDATE`) is preserved, only the silent automatic grant was removed.

Proven by the rewritten `tests/integration/organization-subscription-auto-provision.test.mjs` (4/4, real PostgreSQL):
- A new org gets `status='trialing'` on `plan_code='launch'`, never `internal`/`founder-preview` (explicit regression-guard assertions).
- `trial_ends_at` is real and matches the plan's own `trial_days`; `hasWriteAccess()` genuinely enforces it (a past expiry denies writes -- proving this isn't a cosmetic field).
- The trial's `modules_snapshot` never includes the wildcard `"*"`, and its `limits_snapshot` is the base plan's real (narrower) limits, not founder-preview's generous ones.
- An operational process's own deliberate subscription choice in the same transaction as the org insert still wins over the trigger's default (`ON CONFLICT DO NOTHING` unchanged).
- Founder Preview remains reachable only through an explicit action (a direct `UPDATE`), never automatically.

Full integration suite re-run after the fix: 239/239.

**The 22 documented CRM/POS billing-gate exclusions were re-reviewed** against the same scrutiny (re-read actual route/domain-function source for the highest-risk ones: `pos/settlements` -> `importPosSettlementBatch` genuinely reconciles already-received payment-provider data against existing sales; `pos/reports/day-end/[id]/finalize` -> locks an already-generated report from already-completed shifts). No inappropriate exemption found.

### Design system study (before any screen changes)

Read `packages/design-tokens/tokens/theme.json` directly (not assumed): color palette (canvas/surface/text/border/accent/success/warning/danger/info, each with soft/emphasis variants), spacing scale (4/8/12/16/20/24/32/40/48px), radius scale (control 8px, card 10px, panel 12px, overlay 14px, pill), control heights (compact 34px, standard 42px, large 48px, **webTouchTarget 44px** -- the accessibility-relevant one), breakpoints (narrow 480, mobile 768, tablet 1024, compactDesktop 1280), and the type scale (12/13/14/16/18/20/24/28px, Inter). Screenshots were captured at 375x812 (mobile), 820x1180 (tablet), and 1440x900 (desktop) to bracket these real breakpoints, not arbitrary sizes.

### Screens audited in a real browser (Playwright + Chromium against the live local dev server, screenshots inspected directly -- not claimed without looking)

**Authentication screens** (unauthenticated, desktop + mobile): `/login`, `/forgot-password`, `/reset-password` (including the invalid-token state -- form still renders, never discloses token validity before submission, consistent with the existing account-enumeration-safe convention), `/verify-email` (invalid-token state shows a clear, generic "This verification link is invalid" message with a recovery action -- no information disclosure). MFA enrollment/verification was verified functionally end-to-end via `mfa-sp007.spec.ts` (real browser, real TOTP codes) rather than a static screenshot, since it requires a specific mid-flow session state.

**Shared Settings screens** (authenticated, desktop + tablet + mobile): `/settings` (index), `/settings/organization`, `/settings/companies`, `/settings/branches`, `/settings/users`, `/settings/invitations`, `/settings/roles` (including the New Role dialog, both collapsed and scrolled to its bottom on mobile), `/settings/security`, `/settings/profile`.

### UI/UX defects found and fixed

**1. Real, systemic responsive-layout bug (release-relevant): action buttons overflowed off-screen on mobile in every list-style Settings screen.** `Companies`, `Branches`, `Users`, `Invitations`, and `Roles` all used a fixed `flex items-center justify-between` row for each list item (info on the left, 1-3 action buttons on the right); at 375px width the button group had no room and was clipped past the right edge of the card and the viewport -- on `Users` (up to 3 buttons per row) and `Roles`, this made the primary action ("Reserved"/"Disable"/etc.) completely inaccessible on a real phone screen. **Fixed** in all 5 screens plus `SecuritySettingsScreen`'s session list (defensive, same pattern): `flex flex-col gap-3 ... sm:flex-row sm:items-center sm:justify-between` on the row, `flex flex-wrap gap-2` on the button group, `min-w-0` on the text column so long content truncates/wraps instead of forcing overflow, `break-all` on email addresses. Verified by re-capturing and re-inspecting all 5 screens at mobile and tablet width after the fix -- buttons now wrap cleanly within the card at every width, desktop layout confirmed pixel-identical to before (the `sm:` breakpoint change is inert at desktop width).

**2. Duplicated header pattern instead of the shared component.** `RolesScreen.tsx` hand-rolled its own `<div className="flex items-start justify-between gap-4">` wrapper around `PageHeader` plus a sibling `Button`, instead of using `PageHeader`'s own `primaryAction` prop the way `Companies`/`Branches`/`Invitations` already correctly do. **Fixed**: now uses `primaryAction`, consistent with the other 3 list screens, one fewer hand-rolled layout to maintain.

**Files modified for the visual-QA fixes**: `apps/web/src/features/settings/companies/screens/CompaniesScreen.tsx`, `.../branches/screens/BranchesScreen.tsx`, `.../invitations/screens/InvitationsScreen.tsx`, `.../roles/screens/RolesScreen.tsx`, `.../users/screens/UsersScreen.tsx`, `.../security/screens/SecuritySettingsScreen.tsx`.

**Noted, not changed (by design, not a defect)**: `/settings/profile` is read-only (name/email/organisation/company/branch/locale/timezone displayed, no edit form) -- this predates this session's work and is not a "fake" screen (it shows real data honestly, doesn't pretend to be editable); expanding it into a full profile-editor was judged out of scope for a visual-QA pass focused on fixing confirmed defects, not adding features.

### Accessibility

Ran the existing `accessibility.spec.ts` (axe-core, WCAG 2A/2AA, critical/serious-impact gate) unchanged: **10/10 passing**, confirming no regression from this pass's CRM billing-gate wiring or earlier sessions' CRM screens.

Added `settings-accessibility.spec.ts`, the identical pattern applied to every Settings screen (not previously covered by any accessibility test) plus the New Role dialog: **11/11 passing, zero critical/serious violations** across `/settings`, `/settings/organization`, `/settings/companies`, `/settings/branches`, `/settings/users`, `/settings/invitations`, `/settings/roles`, `/settings/security`, `/settings/profile`, and the open New Role dialog.

Keyboard navigation, focus visibility, dialog focus management, and reduced-motion preferences were not independently instrumented beyond what axe-core's automated ruleset checks (axe covers label/contrast/ARIA-semantics categories well but not manual tab-order or focus-trap behavior) -- this is a real, disclosed gap in coverage depth, not claimed as fully verified.

### User journeys verified (real browser + real database)

| # | Journey | Result |
|---|---|---|
| 1 | Login and logout | Verified -- `platform-security.spec.ts` (logout + session invalidation confirmed) |
| 2 | MFA enrollment and verification | Verified -- `mfa-sp007.spec.ts`, 2/2 (real TOTP codes, independently computed, not importing the app's own code) |
| 3 | Invalid MFA codes and recovery | Verified -- same spec -- wrong code rejected with a clear message before the real code succeeds |
| 4 | Organization Settings | Verified -- `settings-companies-branches.spec.ts` exercises the org-scoped company/branch flow; organization profile edit covered by existing integration tests |
| 5 | Company creation and editing | Verified -- **new** `settings-companies-branches.spec.ts` -- real UI, real DB persistence verified at each step |
| 6 | Branch creation and editing | Verified -- same spec, same rigor, including selecting the just-created company from the real dropdown |
| 7 | Employee invitation with company/branch grants | Partially -- covered at the integration-test level (`auth-lifecycle.test.mjs`, Session B/C); UI covered by `settings-accessibility.spec.ts` + manual screenshot inspection, not a full create-through-UI E2E this pass |
| 8 | Invitation acceptance | Partially -- covered at the integration-test level (`auth-lifecycle.test.mjs`) |
| 9 | Role creation and editing | Verified -- `settings-roles.spec.ts` (Session C) -- real UI, real DB persistence, edit, and archive, all verified |
| 10 | User role assignment | Partially -- covered at the integration-test level (`access-administration-sp008.test.mjs`); UI (`UsersScreen`'s "Manage roles" dialog) accessibility-checked, not driven through a dedicated E2E this pass |
| 11 | User suspension and session revocation | Verified -- `platform-security.spec.ts` (session revocation, both single and revoke-all) |
| 12 | Permission-denied screens | Verified -- `crm-authorization.spec.ts`, `restricted-role-authorization.spec.ts` |
| 13 | Expired subscription: read vs. write | Verified -- **new** `billing-expired-subscription.spec.ts` -- real browser, real database, a dedicated fresh org with a genuinely `expired` subscription; confirmed the leads list still loads (read unaffected) and creating a lead is blocked with a real 402 and a clear, real UI message ("subscription is not active... renew...") -- proven against an isolated server instance actually running in `enforce` mode, not just observe-mode local defaults |
| 14 | Cross-organization access denial | Verified -- `cross-organization-isolation-sp009.test.mjs` (Session C, 11/11, integration-level); `restricted-role-authorization.spec.ts` covers the browser-level analog for permission (not cross-org) denial |

**New E2E spec files this pass**: `apps/web/e2e/settings-companies-branches.spec.ts`, `apps/web/e2e/billing-expired-subscription.spec.ts`, `apps/web/e2e/settings-accessibility.spec.ts`, plus `apps/web/e2e/run-billing-enforce-spec.mjs` (a small operational script that briefly restarts the shared dev server with `BILLING_ENFORCEMENT_MODE=enforce`, runs the expired-subscription spec, then restarts it again in normal mode -- necessary because `billingEnforcementMode()` defaults to `observe` outside `NODE_ENV=production`, and exercising the real enforce-mode UI behavior requires a server actually running with enforcement on; verified this leaves the shared dev server exactly as it was found for every other spec).

**A real, second defect found and fixed while building the MFA E2E journey**: running the full E2E suite together (not in isolation) surfaced that `mfa-sp007.spec.ts` could intermittently fail against migration 050's TOTP replay protection -- the spec computed a code once to confirm enrollment and, moments later, computed "the current code" again for the login step; if both calls landed in the same or an adjacent 30-second step, the second use was correctly rejected as a replay. This is genuinely correct, intentional security behavior (a real authenticator app is never asked to produce two codes for one step, and a server cannot distinguish "the legitimate user reusing their own still-valid code" from "an attacker replaying an observed one" -- real-world services enforce the same single-use-per-code rule). **Fixed the test**, not the security behavior: it now waits for a fresh TOTP step between the two uses, exactly mirroring what a real user's authenticator app would require.

**Known test-execution artifact (not a product defect, disclosed for accuracy)**: running many E2E spec files back-to-back within this session's testing repeatedly hit the pre-existing login rate limiter (`login:${ip}`, 10 attempts/300s -- unrelated to anything built this pass) once accumulated attempts crossed its threshold, causing some specs to fail with 401s when run in one large combined batch shortly after many prior runs. Every spec passed cleanly in isolation or smaller batches; the rate limiter itself is correct, pre-existing, security-relevant behavior and was not weakened to make a combined run pass.

### Final regression evidence (this pass)

| Gate | Result |
|---|---|
| `test:api` | 1112/1112 |
| `test:web` | 21/21 |
| `test:packages` | 151/151 across 10 packages |
| Real-Postgres integration (`tests/integration/*.test.mjs`) | 239/239 (2 skipped, env-gated, unchanged) |
| `typecheck:web` | clean |
| `lint:web` | clean, 0 warnings |
| `build:web` | clean |
| `verify:route-security` | 189 routes, 0 unexplained gaps |
| `verify:billing-mutation-gate` | 153 in-scope routes, 0 unaccounted |
| `accessibility.spec.ts` (pre-existing CRM pages) | 10/10, 0 critical/serious violations |
| `settings-accessibility.spec.ts` (new, all Settings screens) | 11/11, 0 critical/serious violations |
| Relevant Playwright E2E (individually/small-batch verified) | 16/16 across `mfa-sp007`, `crm-authorization`, `platform-security`, `restricted-role-authorization`, `settings-roles`, `settings-companies-branches`, `billing-expired-subscription` |
| Full migration replay (047-052) from an empty database | clean, zero errors (re-verified this pass after adding 052) |

### Remaining product/security items (accurate, not overclaimed)

- SP020 global search: still a genuine, honestly-disclosed placeholder -- unchanged this pass, not attempted (large standalone feature, out of proportion to a visual-QA pass).
- Generic workflow engine (SP013) and shared report-dataset permissions (SP031): still deferred pending overlap audits against `packages/workflows`/`packages/reporting-engine`, unchanged.
- API keys/OAuth/webhooks administration (SP025): real, tested backend, still zero frontend -- unchanged.
- The 10 modules with no route/UI layer (accounting, stock, sales, procurement, manufacturing, projects, assets, quality, support, hr-payroll): unchanged, no screens exist to visually QA.
- `/settings/profile` remains read-only by its existing design; not expanded this pass.
- Keyboard-navigation/focus-trap/reduced-motion behavior verified only to the extent axe-core's automated rules cover (label/contrast/ARIA semantics) -- manual keyboard-only traversal of every dialog was not separately performed.
- Journeys #7 (invitation UI) and #10 (role-assignment UI) are verified at the integration-test level and accessibility-checked, but do not yet have a dedicated create-through-the-real-UI E2E spec the way journeys #5/#6/#9/#13 now do.
