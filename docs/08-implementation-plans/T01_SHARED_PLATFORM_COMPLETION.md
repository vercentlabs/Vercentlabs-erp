# T01 — Shared Platform + Experience Kernel Completion

## Classification

Canonical implementation wave: `T01`

This document records the engineering completion candidate for the T01 shared-platform requirements. It does **not** promote product readiness and it does not replace human UAT.

## Canonical scope

T01 owns the following 21 shared-platform requirements:

`SP010–SP013`, `SP017–SP028`, `SP031–SP034`, and `SP036`.

T00 is the required predecessor. W01/W02/W03 remain dependency-gated until T01 reaches its canonical exit gate.

## Implemented completion surfaces

- SP010 — module entitlement enforcement remains authoritative at navigation/API/server boundaries.
- SP011 — subscription enforcement now has durable idempotent usage-event metering.
- SP012 — existing approval and segregation-of-duties contracts remain the only approval authority.
- SP013 — workflow runs are durable/idempotent and the generic engine is restricted to shared-platform side effects; business mutations remain module commands/approvals.
- SP017 — notification preference center with per-user/channel/category state.
- SP018 — outbound email foundation plus signed/idempotent inbound-mail evidence.
- SP019 — attachment type validation, malware scan policy, quarantine/clean lifecycle and download gating.
- SP020 — permission-aware bounded shared search remains the platform search authority.
- SP021 — controlled tag definitions/assignments plus existing custom-field foundation; no arbitrary code/SQL extensibility.
- SP022 — existing canonical numbering/reference generation remains authoritative.
- SP023 — durable import idempotency binds key to request fingerprint and replays committed results.
- SP024 — tenant API keys, scoped API principal and versioned `/api/v1` contract.
- SP025 — encrypted Google/Microsoft OAuth connections plus existing signed/retrying outbound webhook runtime.
- SP026 — effective-dated configuration and feature flags serialize concurrent writers and prevent ambiguous windows.
- SP027 — existing localization/timezone/currency/UOM platform remains authoritative.
- SP028 — retention-policy history and governed data-subject request state machine. Privacy/security administration is not disabled by billing lockout.
- SP031 — governed shared report definitions launch only real module reports and re-check module-report permission; no fictitious SQL/scheduler engine is claimed.
- SP032 — existing accessibility validation and inclusive shared UI patterns remain required by repository verification.
- SP033 — Experience Kernel/shared shell/responsive web contracts remain required by repository verification.
- SP034 — existing mobile authentication/idempotency/offline-sync architecture remains required by mobile verification.
- SP036 — organization AI policy, fail-closed request evidence, tool allow-listing and evaluation evidence; generic AI never gains implicit business-command authority.

## Database changes

- `database/platform/migrations/035_t01_shared_platform_completion.sql`
- `database/tenant/migrations/075_t01_import_idempotency.sql`

The migration prefixes must be centrally reserved before application and become `CONSUMED` only when the corresponding SQL exists. Historical migrations remain immutable.

## Security invariants

1. Raw API-key tokens are returned only at creation and stored only as SHA-256 hashes.
2. OAuth state is one-time/short-lived; provider token exchange occurs outside the database lock transaction.
3. OAuth redirects are pinned to configured `APP_URL`, never an incoming Host header.
4. OAuth credentials use AES-256-GCM with an operator-managed 32-byte encryption key.
5. Inbound mail requires HMAC verification and binds provider message identity to the original payload digest.
6. Attachment download requires a clean/not-applicable scan state; production upload scanning fails closed when the scanner is not configured.
7. Effective-dated shared configuration/flags/retention policies serialize concurrent writers.
8. Shared reporting re-checks the underlying module report permission at launch.
9. AI is denied until policy exists; execute authority remains off by default and approval/business-command authority is not bypassed.
10. Privacy/security revocation controls remain available even when commercial write access is blocked.

## Automated certification

The authoritative candidate commands are:

```bash
corepack pnpm verify:t01
corepack pnpm verify:db
corepack pnpm verify:architecture
corepack pnpm verify:mobile
corepack pnpm release:verify
node scripts/validation/verify-t01-live.mjs
```

The installer additionally runs migration application, agent-scope validation, parallel-governance validation and worktree hygiene before integration.

## Completion semantics

After every automated gate passes, T01 may become `CANDIDATE_COMPLETE` with `exit_gate_status=PENDING`.

Per `IMPLEMENTATION_MASTER_PLAN.md`, T01 may become `COMPLETE/PASS` only after the human UAT packet in `T01_SHARED_PLATFORM_UAT.md` is signed off. The 21 implementation rows may be `IMPLEMENTED` while their `product_status` remains `NOT_READY`; implementation completion is not product readiness.
