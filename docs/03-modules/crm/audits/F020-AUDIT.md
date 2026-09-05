# F020 Territories and sales teams — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). Territories/team-assignments are managed entirely through the generic `createCrmRecord`/`updateCrmRecord`/`listCrmRecords` resource pattern (`resources.territories`/`resources["territory-assignments"]` in `index.js:492-534`), not dedicated functions like Accounts' hierarchy engine.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 (configure without **cycles**, overlap ambiguity, stale assignments) | **PARTIAL — 1 concrete, comparable gap.** `crm_territories` has a `parent_territory_id` column (hierarchy structurally supported), **but because territory updates go through the generic record handler rather than a dedicated function, there is no cycle-detection check analogous to F002 Accounts' `setAccountParent` (which uses a recursive CTE, `account-intelligence.js:180-199`)** — a territory's parent could in principle be set to create a cycle with no server-side rejection. This is directly comparable to and just as real as F002's carefully-solved version of the same problem; it just wasn't solved here. |
| CAP-002 (hierarchies, overlays, **effective dates**, **quotas**, temporary delegation, coverage gaps, forecast alignment) | **PARTIAL, better than expected on 2 of 6.** Effective dates: PASS — `crm_territory_assignments` has real `effective_from`/`effective_to` columns with a uniqueness constraint scoped to them (`003_crm_enterprise_core.sql:72`), and F005's audit already confirmed `activeTerritoryUserIds` correctly filters on `effective_from<=current_date AND (effective_to IS NULL OR effective_to>=current_date)`. Quotas: PASS — a real `crm_quota_plans` table exists with a validated FK to territories. **Gaps:** no cycle-check (see CAP-001); no "overlay" concept (a shared/secondary territory assignment distinct from the primary) found; no explicit temporary-delegation mechanism (a time-boxed handoff of territory ownership) beyond what `effective_from`/`effective_to` already provide generically; coverage-gap detection (reporting on unassigned/under-covered territory) not found. |
| CAP-003 (F005/F025 consume the contract, don't invent hierarchy semantics) | PASS | F005's audit already confirmed `activeTerritoryUserIds` reads `crm_territory_assignments`/`crm_territories` directly rather than reimplementing territory logic. |
| FR-001/002/003 | PASS | generic CRUD gives validation/permission/conflict states; pagination inherited from `listCrmRecords`. |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PARTIAL | governed create/update/archive lifecycle exists generically; the cycle-safety gap under CAP-001 is the specific weakness in this row. |
| BR-001/BR-002 | PASS | single mutation path (generic record handler); no evidence of a separate uncontrolled write path. |
| DATA-001/002 | PASS | `crm_territories`, `crm_territory_assignments`, `crm_quota_plans` all exist and relate correctly. |
| VAL-001/002 | PASS (structural, via the generic schema validators) | not independently re-derived beyond confirming the schema entries exist. |
| CALC-001 | N/A | no derived calculation in this feature itself (quota attainment would live in F025 Sales forecast). |
| UX-001/002/003 | NOT INDEPENDENTLY VERIFIED | No dedicated `f020` test file found this pass; likely covered by the generic CRM settings/resource tests rather than a feature-specific suite. |
| SEC-001/002 | PASS | `requireCrmResourceView`/`requireCrmManage` apply uniformly through the generic route, already verified directly for this route family. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | PASS | generic-resource route pattern, already verified directly. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

18 of 37 rows PASS or PASS-with-caveat, fewer than most CRM features audited so far — reflecting that this feature leans entirely on generic CRUD rather than dedicated domain logic, unlike its closest architectural sibling (F002 Accounts). The clearest, most concrete finding: territory hierarchy has no cycle protection, while the near-identical account hierarchy problem was solved correctly elsewhere in the same module — this is the single cheapest, highest-value fix to carry into the gap-closing pass (copy F002's recursive-CTE pattern).
