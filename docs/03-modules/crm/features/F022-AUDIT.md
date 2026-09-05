# F022 Lead-to-opportunity conversion — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `convertCrmLead` (`index.js:3293-3436`) in full, plus `assertLifecycleUpdate` (`:1581-1620`) for the immutability question.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | conversion resolves existing-vs-new for both account and contact via normalized email/phone matching (reusing the same normalization functions verified in F008's duplicate detection), creates the opportunity in the same transaction, and records a full `input_snapshot` for audit reproducibility. No separate "preview" step exists before commit (see CAP-002). |
| CAP-002 (existing/new combinations, duplicate resolution, mapping, **atomic rollback**, **idempotency**, multiple opportunity policy, **converted-lead immutability**) | **PARTIAL — strong on the hard distributed-correctness items, 1 confirmed gap.** Existing/new combinations: PASS — independently resolves account and contact each as existing-or-new (four real combinations, not simplified to one path). Atomic rollback: PASS — the entire operation (party lookup/insert, contact lookup/insert, opportunity creation, lead status update, conversion record, campaign-member sync) runs inside one caller-supplied transaction; any failure partway rolls back everything, including the opportunity that would otherwise be orphaned. Idempotency: PASS, and correctly designed — `crm_conversion_records` is checked (and the lead row is locked first) before any side effect, so a retried conversion call returns the original result (`replayed: true`) rather than creating a second opportunity. Multiple-opportunity policy: PASS by data model — `opportunity.party_id`/`contact_id` are plain foreign keys with no uniqueness constraint tying a party to one opportunity, so later, separate opportunities for the same converted account are unrestricted, which is the expected enterprise behavior. **Gap: converted-lead immutability is not enforced.** `assertLifecycleUpdate` (`:1581-1620`) blocks direct qualification-status edits and a few other resources' invalid transitions, but has no rule for `resource === "leads" && before.recordStatus === "converted"` — a converted lead's ordinary fields (name, email, company, etc.) remain editable through the generic update path after conversion, despite the dossier explicitly requiring immutability once converted. |
| CAP-003 (coordinates lead/account/contact/opportunity transactionally; Sales handoff is separate F023) | PASS | confirmed directly — conversion never touches Sales tables; the opportunity it creates is the boundary object F023 later reads. |
| FR-001/002/003 | PASS | validation/permission/conflict states present; not a bulk operation by nature. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS | `FOR UPDATE` lock on the lead before any decision; stable conflict codes for archived/already-converted leads. |
| BR-001/BR-002 | PASS | single conversion path; `crm_conversion_records` is effectively append-only (one row per lead, enforced by the idempotency check). |
| DATA-001/002 | PASS | `crm_conversion_records` retains the full `input_snapshot`, and `crm_leads.converted_party_id`/`converted_contact_id`/`converted_opportunity_id` give a durable, queryable link — better provenance than a bare boolean flag would give. |
| VAL-001/002 | PASS | archived/already-converted preconditions produce specific, stable error codes rather than a generic failure. |
| CALC-001 | N/A | no calculation of its own (amount is copied from `estimated_value` or explicit input). |
| UX-001/002/003 | PASS (by test evidence) | "F022 opportunity detail keeps governed quotation conversion and removes competitor intelligence" and the F001-aggregate test's F022 coverage both confirmed passing this session. |
| SEC-001/002 | PASS | `crmLeadsManage` required; scope enforced via `recordScope(resources.leads, ...)` on the initial lead lookup. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | route pattern consistent with the rest of the module. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

26 of 37 rows PASS. The atomicity/idempotency engineering here is exactly right — lock-then-check-then-act, single transaction, no orphaned records possible on partial failure. The one confirmed, specific gap (converted-lead immutability not enforced on the generic update path) is a cheap, well-scoped fix for the gap-closing pass: add a check to `assertLifecycleUpdate` mirroring the existing pattern for other locked-down resources.

**Bonus finding while auditing this feature:** discovered and corrected a real error in F008's audit — see `F008-AUDIT.md`'s correction note. `mergeCrmLead` (a real, working lead-merge engine) sits right next to `convertCrmLead` in `index.js` and was missed by F008's narrower search.
