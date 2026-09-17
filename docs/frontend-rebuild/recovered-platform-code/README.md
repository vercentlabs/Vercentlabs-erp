# Recovered platform code — NOT active, NOT wired into any build

## What this is

43 files (~8,000 lines), recovered verbatim from
`archive/pre-clean-frontend-rebuild` (the pre-deletion snapshot of the old
frontend — see `docs/frontend-rebuild/README.md`), restoring real
business/security logic in three related batches:

- **T01 shared platform** (SP010–SP036: module entitlements, billing usage
  events, attachment security, API keys, OAuth integrations, inbound mail
  webhook verification, privacy requests, feature flags/tags, AI
  policy/approval governance, cross-tenant search, module access control).
- **Enterprise RBAC/access administration** (found while fixing the T01
  gap's sibling check, `test:enterprise-rbac`): role-template definitions
  (`core/access-control.ts`), user/invitation management routes, auth
  session handling (`core/auth.ts`), delegated-administration scoping
  (`core/access-admin.ts`), and the web/mobile administration UI that
  surfaced these roles.
- **CRM route handlers referenced by `services/api`'s own test suite**
  (found while running the full verification graph — `pnpm test:api` was
  failing outright, 0 tests able to run, not just some): a follow-up API
  route, an audit-events module, an SLA route, a lead-enrichment route, a
  public meeting-booking route, and its route-handler logic — all
  web-side-only CRM logic that `services/api/tests/*.test.mjs` reads
  directly to assert on, with no equivalent in `services/api/src` itself.

All three batches were found the same way: a root verification script
failed against a deleted path, and tracing the failure revealed real
logic with no replacement elsewhere in the repo, not just a stale
reference. The third batch in particular means `pnpm test:api` — the
core backend test gate, 887 tests — was fully broken (erroring before a
single test could run) before this pass, for a reason that had nothing to
do with the API code itself.

## Why this exists

This logic lived under `apps/web/src/core/` and `apps/web/src/app/api/`
in the old architecture, alongside the frontend. When `apps/web` was
deleted wholesale as part of the clean-slate rebuild, these files were
deleted with it — **and no equivalent exists anywhere else in the
repository.** `services/api/src` has no OAuth, API-key, privacy, or
feature-flag modules under any name. This was found during a post-rebuild
repository-hygiene pass (`verify:t01` failing against deleted paths), not
anticipated in advance.

This is a real gap: production-relevant security and platform logic that
existed before the rebuild currently has no home in the new architecture.
Recovering it here is **preservation, not restoration** — nothing in this
directory is imported by, or reachable from, any active application code.
It exists so the logic isn't lost to git-archaeology alone, pending a
deliberate decision about where it belongs.

## What needs to happen (tracked, not done in this pass)

This was explicitly out of scope for the repository-hygiene pass that
recovered these files (no feature implementation, no architecture
decisions). Before any of this is ported into an active path, it needs:

1. **An architectural decision**: this logic is backend/domain logic that
   happened to live inside the old Next.js app (importing `@/core/db`,
   `@/core/auth`, `@/core/http` — all old apps/web-relative aliases that
   won't resolve as-is). Per `WEB_FRONTEND_ARCHITECTURE.md`'s
   business-authority boundary, this almost certainly belongs in
   `services/api/src` now, not back inside `apps/web` — but that's a call
   for whoever owns that decision, not assumed here.
2. **A real security review** before anything here goes live again —
   this code handles OAuth secrets, API key material, and inbound
   webhook signature verification; do not copy-paste it into an active
   path without re-verifying it against current `SECURITY_STANDARD.md`
   and `SECURITY_THREAT_MODEL.md` expectations.
3. **Reconciliation with `docs/04-shared-platform/requirements/`** — the
   SP010-SP036 dossiers this code was built against are untouched by the
   rebuild and still describe the intended behavior; verify this recovered
   code still matches them before treating it as ground truth.

## What changed to keep CI honest in the meantime

- `scripts/validation/verify-t01-shared-platform.mjs` now reads from this
  parked location instead of the deleted `apps/web` paths, and its output
  explicitly states the code is parked/not wired in.
- `test:enterprise-rbac` (root `package.json`) now runs the parked
  `apps/web/tests/enterprise-rbac.test.mjs` against the parked
  `access-control.ts` and the live `packages/permissions` package — path
  resolution inside that test was adapted to work from this location
  (see the comment at the top of the file), the actual assertions are
  unchanged from the original.
- `services/api/tests/{crm-calls-f013,crm-lead-assignment-f005,
  crm-leads-record-detail-contract,crm-meeting-booking-token-expiry-f014,
  crm-meetings-f014}.test.mjs` had their `read(...)` calls repointed at
  this parked directory instead of the deleted `apps/web` paths — same
  treatment, assertions unchanged, `pnpm test:api` now runs (887/887
  passing) instead of erroring before it starts.

A pass on any of these means "the recovered snapshot still contains the
expected patterns and is internally consistent," not "this capability
works in production." Neither shared-platform nor the web-layer RBAC
administration surface nor these specific CRM routes exist in production
right now — `services/api`'s own CRM domain logic (everything under
`services/api/src/modules/crm`) is unaffected and still fully live; only
the thin web-route-handler layer these tests happen to also assert on is
gone.
