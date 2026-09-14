# F065 Supplier onboarding — Atomic requirement trace

Dossier wants: `DRAFT -> SUBMITTED -> VALIDATING/QUALIFYING -> PENDING_APPROVAL
-> APPROVED/SPEND_AUTHORIZED or REJECTED; later SUSPENDED/REOPENED`, with
document/tax/bank verification, duplicate detection, sanctions/compliance
hooks, approver separation.

Onboarding is not a separate resource — it **is** the `suppliers` lifecycle
(`draft -> submitted -> qualified -> active`, `TRANSITIONS.suppliers`,
`index.js:1278-1284`) plus the `supplier-qualifications`/
`supplier-certifications` child resources. See `F063-AUDIT.md` for the
shared engine evidence (permission gates, sensitive-field redaction,
concurrency, audit/idempotency) — not repeated here.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FLOW-001 | PARTIAL | Real states exist (`draft/submitted/qualified/active/blocked/suspended/cancelled`) but the dossier's distinct `VALIDATING`/`PENDING_APPROVAL`/`SPEND_AUTHORIZED` states collapse into two transitions (`submit`, `qualify`) with no separate "validating" or explicit approval-queue state — a submitted supplier goes straight to `qualified` on one `qualify` action, gated by one permission. "Spend-authorized" isn't distinct from `active` at all. |
| **CAP-002 — tax/bank verification.** | **GAP.** No verification step exists — bank fields are protected from unauthorized view/write (`F063`'s SEC-002), but nothing checks a tax registration number's format/validity or confirms bank details via any external or internal verification step before a supplier reaches `qualified`/`active`. |
| **CAP-002 — sanctions/compliance hooks.** | **GAP, confirmed absent.** No sanctions-list, denied-party or compliance-screening reference anywhere in `procurement/*.js`. This is very likely a real product gap (would need an external provider), not a code defect this session can fix — flag for the shared-platform/external-provider backlog. |
| **CAP-002 — duplicate detection.** | **GAP.** Same finding as F063 CAP-002: no duplicate-supplier check exists anywhere. |
| **CAP-002 — rejection/resubmission.** | PARTIAL | `reject` exists as a transition FROM `submitted`/`pending_approval`... wait, checked: `TRANSITIONS.suppliers` has no `reject` action at all — only `submit/qualify/activate/block/suspend/cancel`. **A submitted supplier cannot be rejected**, only cancelled (which requires status `draft`/`submitted` — cancel IS available from `submitted`, but "cancelled" and "rejected" are different business concepts the dossier expects, and there's no resubmission-after-rejection path since rejection itself doesn't exist as a state). |
| APP-001 (approver separation) | PASS (partial) | `transitionProcurementRecord`'s self-approval guard (`["approve","qualify"].includes(action) && current.created_by === context.userId` throws `PROCUREMENT_SELF_APPROVAL`) DOES apply to the `qualify` action — the creator of a supplier record cannot qualify their own submission. Real segregation-of-duties enforcement, test-worthy. No multi-stage chain beyond this single check. |
| **UX (onboarding evidence UI) — GAP, confirmed.** | See F063's corrected finding: qualifications/certifications are real child resources but have **zero UI** anywhere to create or view them. An operator cannot actually complete "onboarding" (submit qualification/certification evidence) through the product — only via direct API calls. This is the most concrete, user-facing gap for this feature specifically. |
| SEC-001/002 | PASS | Same as F063. |
| NOTIF-001 | GAP (module-wide) | See F063 — outbox never consumed. |
| E2E | GAP (module-wide) | See F063 — zero Procurement E2E exists. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The permission/concurrency/audit foundation is solid and the self-approval
guard is a genuine, real control. But "onboarding" as the dossier describes
it — document capture, tax/bank verification, duplicate detection,
compliance screening, a real rejection/resubmission path — is mostly
**not built**: the lifecycle only has `submit`/`qualify`/`activate`, no
`reject`, no verification steps, and the evidence (qualifications/
certifications) that the governance dashboard requires has no UI to enter
it. This is closer to `FOUNDATION ONLY` than a complete feature.
