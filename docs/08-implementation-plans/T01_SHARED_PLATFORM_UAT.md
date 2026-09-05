# T01 — Shared Platform + Experience Kernel UAT

## Purpose

This is the required human acceptance packet for promoting canonical T01 from `CANDIDATE_COMPLETE/PENDING` to `COMPLETE/PASS`. Automated tests do not self-sign this document.

## Preconditions

- `corepack pnpm verify:t01` passes.
- `corepack pnpm release:verify` passes.
- platform migration 035 and tenant migration 075 are applied and `verify-t01-live.mjs` passes.
- the tester uses an organization-owner/system-administrator account plus a restricted account for negative checks.

## Acceptance walkthrough

| Check | Canonical scope | Human validation | Expected result | Sign-off |
|---|---|---|---|---|
| T01-UAT-01 | SP010/SP011 | Disable/deny a module or hit a commercial allowance using a controlled tenant. | Navigation/API/server enforcement agrees; retry-safe metering does not double count. | PENDING |
| T01-UAT-02 | SP012/SP013 | Submit an approval and execute an allowed shared workflow twice with the same idempotency key. | SoD/approval authority is preserved; second workflow request replays and no business command is bypassed. | PENDING |
| T01-UAT-03 | SP017/SP018 | Change notification preferences; send one signed inbound-mail payload and replay it; then reuse the provider ID with different content. | Preference persists; exact replay is harmless; changed-content replay fails visibly. | PENDING |
| T01-UAT-04 | SP019 | Upload a permitted attachment and a deliberately rejected/mismatched test file. | Clean file is available; rejected/quarantined content cannot be downloaded. | PENDING |
| T01-UAT-05 | SP020/SP021/SP022 | Search as restricted user; create/assign a controlled tag; generate a numbered reference. | No unauthorized search leakage; tag stays tenant/entity scoped; numbering remains deterministic. | PENDING |
| T01-UAT-06 | SP023 | Import valid/invalid rows, then retry with the same key and then the same key with changed content. | Original result replays without duplicate rows; changed-content reuse fails with an actionable conflict. | PENDING |
| T01-UAT-07 | SP024/SP025 | Create/revoke API key; call `/api/v1/platform/context`; start/complete/revoke configured OAuth connection. | Token is shown once, scope enforced, revocation works even under billing restriction, OAuth returns to canonical app origin. | PENDING |
| T01-UAT-08 | SP026/SP027 | Create effective-dated configuration/flag and inspect timezone/currency/localization behavior. | Ambiguous schedules are rejected; effective value and locale behavior are deterministic. | PENDING |
| T01-UAT-09 | SP028 | Create/transition privacy request and create a retention version while commercial writes are restricted. | Privacy controls remain available; invalid state transitions and overlapping schedules fail closed. | PENDING |
| T01-UAT-10 | SP031 | Save/open a governed report as authorized user and try a report family without its module report permission. | Authorized launch records evidence and opens real report; unauthorized dataset is denied. | PENDING |
| T01-UAT-11 | SP032/SP033 | Inspect platform/integrations/notifications/settings surfaces at 320px, 390px and desktop using keyboard only. | No horizontal breakage; focus/labels/tables/errors are usable and Experience Kernel patterns remain consistent. | PENDING |
| T01-UAT-12 | SP034 | Sign in on mobile, exercise offline/retry-safe flow and reconnect. | Tenant context is preserved; retry does not duplicate authoritative writes; recovery is visible. | PENDING |
| T01-UAT-13 | SP036 | With no AI policy, try AI request; then enable read/propose policy and attempt an unauthorized tool/execute request. | Missing policy denies; allowed actions record evidence; tool/execute authority remains fail-closed. | PENDING |

## Project Manager final decision

T01 may be promoted only when every row above is signed `PASS`, any defect evidence is resolved, and the integrated commit still passes the automated T01/release/live gates.

- Project Manager decision: `PENDING`
- Integrated commit: `PENDING`
- UAT evidence/reference: `PENDING`

Until those fields are signed, keep `T01 = CANDIDATE_COMPLETE / PENDING`.
