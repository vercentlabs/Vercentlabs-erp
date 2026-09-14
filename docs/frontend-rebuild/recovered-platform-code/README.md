# Recovered platform code — NOT active, NOT wired into any build

## What this is

26 files (5,836 lines), recovered verbatim from
`archive/pre-clean-frontend-rebuild` (the pre-deletion snapshot of the old
frontend — see `docs/frontend-rebuild/README.md`), restoring the real
business/security logic that implemented the "T01 shared platform"
capabilities (SP010–SP036: module entitlements, billing usage events,
attachment security, API keys, OAuth integrations, inbound mail webhook
verification, privacy requests, feature flags/tags, AI policy/approval
governance, cross-tenant search, module access control).

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

`scripts/validation/verify-t01-shared-platform.mjs` now reads from this
parked location instead of the deleted `apps/web` paths, and its output
explicitly states the code is parked/not wired in — a pass here means
"the recovered snapshot still contains the expected security patterns,"
not "the shared-platform system is live." Do not treat a green
`verify:t01` as evidence this capability works in production; it does
not exist in production right now.
