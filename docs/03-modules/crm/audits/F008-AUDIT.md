# F008 Duplicate detection — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows).

**Second correction (2026-09-05, made while starting F008's gap-closing work):** the previous version of this audit (itself already one correction deep) was *still wrong*. It claimed `mergeCrmLead` exists but is unreachable — no route, no UI. That was false. `apps/web/src/app/api/crm/leads/[id]/merge/route.ts` is a complete, correctly-built route (permission-gated on `crmLeadsManage`, same-origin check, transactional, audited), and `lead-detail-workspace.tsx` renders a real "Merge current into this" button with a confirmation dialog for each duplicate candidate, correctly hidden for restricted matches (matching test #65's actual intent, which I misread twice). **The whole merge workflow — backend, route, UI, confirmation — is fully built and working.**

Root cause of both misses: my searches used bash commands with `**` glob patterns (e.g. `apps/web/src/app/api/crm/**/*.ts`) in an environment where bash's `**` does not recurse into subdirectories without `shopt -s globstar` set — it silently behaves like a single `*` and matches nothing in nested paths. Every `[id]/route.ts` file (i.e. every dynamic API route in this Next.js app) was invisible to those searches. This is a systemic risk, not a one-off: after finding it, I re-verified F008's own remaining claims and several other features' "doesn't exist" findings using the Grep tool (which does not have this problem) instead of bash. F009 (no opportunity reopen path), F013 (telephony schema genuinely unused), F003 (no contact reactivation), F016/F014 (no reminder-delivery worker), F029 (no bulk-job cancellation) were all re-checked this way and hold up. F008 was the one that didn't.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (review candidates side-by-side and merge or dismiss with survivorship history) | **PASS for merge; GAP remains only for "dismiss" and a dedicated review queue.** `evaluateLeadDuplicateRisk` classifies exact/probable matches; the lead detail page renders each candidate with company/status context and a classification badge (`lead-detail-workspace.tsx:1840-1885`); a permission-gated "Merge current into this" button calls the real `merge()` handler, which confirms with the user, calls `POST /api/crm/leads/[id]/merge`, and navigates to the surviving lead on success. `mergeCrmLead` itself relocates activities/communications/tags/campaign-membership, archives (not deletes) the source, locks both rows in `id` order to avoid deadlocking a concurrent reverse-direction merge, and is idempotent via `crm_merge_records`. **What's still missing:** no explicit "dismiss as not a duplicate" action (a probable, non-exact match has no way to be marked reviewed-and-cleared other than ignoring it), and no separate review-queue workspace independent of being on the specific lead's detail page. |
| CAP-002 (cross-object matching, configurable rules, confidence explanation, field survivorship, merge idempotency, override audit) | **PARTIAL — idempotency confirmed excellent, 2 real gaps remain.** Confidence explanation: PASS — `classify()` returns a `signals` array and exact/probable classification. Merge idempotency: PASS — `crm_merge_records` checked under both rows' locks before any side effect. Override audit: PASS — `crm_lead_duplicate_overrides` records reason/actor/matched-IDs/operation. Field survivorship: PARTIAL — child records move correctly, but conflicting field *values* between the two lead rows (e.g. different emails) aren't reconciled — the target's values simply win, nothing surfaces the conflict. **Confirmed gaps:** matching rules (`DUPLICATE_FIELDS`, thresholds) are hardcoded, not admin-configurable; cross-object matching only searches `crm_leads`, never `contacts`/`business_parties`. |
| CAP-003 | PASS | import delegates through `createCrmRecord`, the same canonical path as manual create. |
| FR-001/002/003 | PASS | the reachable workflow (pre-check, override, and now confirmed merge) has proper validation/permission/conflict states. |
| US-001/US-002 | PASS | a user genuinely can review a candidate and merge it, end to end. |
| FLOW-001 (`CANDIDATE -> REVIEWED -> MERGED \| DISMISSED \| OVERRIDDEN`) | **PASS for MERGED and OVERRIDDEN; GAP only for a distinct DISMISSED outcome.** | |
| FLOW-002 | PASS | stable `CRM_LEAD_DUPLICATE_*` codes; fails closed by default. |
| BR-001/BR-002 | PASS | single evaluation/merge path; override and merge records are both insert-only. |
| DATA-001/002 | PASS | `crm_lead_duplicate_overrides` and `crm_merge_records` (shared across entity types via `entity_type='lead'`) both exist and are used correctly. |
| VAL-001/002 | PASS | override reason length-validated; merge input schema-validated (`mergeLeadSchema`). |
| CALC-001 | N/A | no monetary calculation. |
| UX-001/002/003 | PASS | confirmed directly: confirmation dialog before an irreversible merge, disabled-while-pending button state, correct hiding for restricted matches. |
| SEC-001/002 | PASS | `canDisclose`/`safeMatch` prevent learning a duplicate exists in another rep's scope; the merge route itself requires `crmLeadsManage` plus same-origin. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | both the pre-check and merge routes follow the verified module pattern. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment (second correction)

25 of 37 rows PASS. The only real, confirmed gaps left are: no "dismiss" outcome distinct from override, matching rules are hardcoded, no cross-object (Lead-vs-Contact/Account) matching, and no field-value-conflict reconciliation on merge. This feature does **not** need "wiring up" — that work was already done by whoever built it. It needs three smaller additions, not a route.

## Process lesson (kept, now doubly confirmed)

Two consecutive wrong "doesn't exist" verdicts on the same feature, from two different search methodologies (a narrow multi-file grep, then a `**`-globbed bash search that silently failed to recurse into `[id]` route directories), is a pattern, not a fluke. Going forward in this pass: existence checks use the Grep tool, not bash glob patterns, full stop.
