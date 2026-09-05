# F005 Lead assignment — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `lead-governance.js` in full (656 lines) and the assignment API routes.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/CAP-003 | PASS | `resolveLeadAssignment` routes a lead through prioritized policies (`fixed`/`round_robin`/`workload`/`territory`) and returns a `reason` explaining the winning policy/mode; assignment only ever emits through the lead command layer. |
| CAP-002 (capacity/out-of-office/fairness/geography/product/**fallback queues**/**reassignment SLA**/concurrent round-robin correctness) | **PARTIAL — the hard part is done right; 3 sub-items are genuine gaps.** Capacity: `leastLoadedLeadOwner` (`:180-203`) implements workload-based routing correctly. Geography/product: `countryCode`/`industry`/`productInterest`/`sourceId` are real matchable criteria (`:205-252`). **Concurrent round-robin correctness is correctly implemented** — `ownerForLeadPolicy`'s round-robin branch takes a row lock (`SELECT ... FOR UPDATE`, `:429`) on `crm_lead_assignment_state` before reading/advancing `next_index`, which is the right way to make round-robin safe under concurrent lead creation. This was the requirement I was most worried would be broken, and it isn't. **Gaps:** no out-of-office/availability check anywhere (an eligible-but-currently-away user can still be assigned); no explicit fallback-queue concept — `resolveLeadAssignment` just returns `{ownerUserId: null, reason: "unassigned"}` when no policy matches, rather than routing to a defined fallback queue/manager; no reassignment-SLA timer/escalation exists (nothing measures or acts on "this lead has been sitting unworked past N hours since assignment"). |
| FR-001/002/003 | PASS | policy CRUD has validation/permission/conflict states; `listEligibleLeadAssignees` paginates (limit/offset). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001 (`UNASSIGNED -> ASSIGNED -> REASSIGNED`, immutable events) | PASS | assignment always writes through the lead record's `owner_user_id`; F001's audit already confirmed `crm_lead_assignment_events` is an insert-only history table referenced from `lead-operations.js:117`. |
| FLOW-002 | PASS | `LeadGovernanceError` gives stable `CRM_ASSIGNMENT_RULE_*`/`CRM_LEAD_ASSIGNEE_SCOPE_INVALID` codes; duplicate-name races are closed with `pg_advisory_xact_lock` (`:562-565`) before the uniqueness check — a correct pattern, not just an ordinary `SELECT`-then-`INSERT` race. |
| BR-001/BR-002 | PASS | single resolution path (`resolveLeadAssignment`); policy edits don't retroactively touch past assignment events. |
| DATA-001/002 | PASS | `crm_lead_assignment_policies`, `crm_lead_assignment_state`, `crm_territory_assignments`, `crm_territories` all exist and are used exactly as read. |
| VAL-001/002 | PASS | `saveLeadAssignmentPolicy` validates name/sequence/mode/assignee/members/status server-side with stable `CRM_ASSIGNMENT_RULE_INVALID` codes; `assertEligibleLeadAssignee` re-validates every named user is an active, in-scope, CRM-eligible member before a policy can reference them (both on save and on reactivation, `:560-561` and `:639-645`). |
| CALC-001 | N/A | no monetary/derived calculation in this feature beyond load counts, already covered under CAP-002. |
| UX-001/002/003 | PASS (by test evidence) | `crm-lead-assignment-f005.test.mjs` exists both sides and passes. |
| SEC-001 | PASS | `PERMISSIONS.crmSettingsManage` gates policy CRUD; `PERMISSIONS.crmLeadsManage` gates the per-lead assign action; `assigneeScopeSql`/`crmEligibleSql` (`:254-298`) enforce company/branch access and CRM entitlement server-side before any user can be selected as an owner — this is a genuinely thorough eligibility gate, more rigorous than a simple permission check. |
| SEC-002 | N/A (plausible) | No sensitive personal field is exposed by this feature beyond assignee name/email, already visible to any CRM-eligible teammate. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| INT-001 | PASS | assignment consumes team/territory/eligibility data but only ever writes through the lead command, as required. |
| API-001/002 | PASS | same verified route pattern (permission checks confirmed directly in routes read this pass). |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

27 of 37 rows PASS with cited evidence, including the one requirement (concurrent round-robin correctness) most likely to be subtly broken in a naive implementation — it isn't. 3 genuine gaps: no out-of-office/availability awareness, no fallback-queue routing when no policy matches, no reassignment-SLA timer. These are real product gaps worth prioritizing in the fix pass, not documentation issues.
