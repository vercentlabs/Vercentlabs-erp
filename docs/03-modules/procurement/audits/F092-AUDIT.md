# F092 Spend analysis — Atomic requirement trace

Dossier: analyze governed spend with permission-safe drilldown to source
transactions. Lifecycle: `SOURCE FACTS -> GOVERNED AGGREGATE/SNAPSHOT ->
DRILLDOWN/EXPORT; source transactions remain authoritative`.

`getProcurementReport("spend-analysis")` (`index.js`'s `REPORT_SQL`,
already read in full) is the implementation, alongside 11 sibling reports
(`purchase-price-variance`, `contract-compliance`, `maverick-spend`,
`open-commitments`, `overdue-orders`, `matching-exceptions`, `savings`,
`cycle-time`, `supplier-risk`, `agreement-consumption`, `supplier-
performance`). Real UI: `apps/web/src/app/(app)/procurement/reports/`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/REP-001 | PASS | 12 real, company-scoped, permission-gated (`procurement.reports.view`) aggregate report queries — genuinely broad coverage (spend by supplier, price variance, on/off-contract spend, maverick spend outside agreements, open commitments, overdue orders, matching exceptions, savings, cycle time, supplier risk, agreement consumption, supplier performance). Not placeholders — each is a real SQL aggregate against live transaction tables. |
| **DRILLDOWN — GAP.** | Each report returns a `dimension_value`/`document_count`/`metric_value` row — an aggregate. No evidenced UI or API path lets a user click a spend-analysis row and drill into the underlying purchase orders that produced it; the report is a dead-end summary, not a drilldown surface. |
| **"Governed aggregate/snapshot" — GAP, confirmed dead.** | `procurement_reporting_facts` is queried alongside the live aggregate (`getProcurementReport` returns both `rows` and `materializedFacts`) but `grep -rl "procurement_reporting_facts" services/` finds **only this one SELECT** — nothing anywhere ever inserts into this table (no worker job, no migration seed, no other module reference). `materializedFacts` is permanently an empty array on every single report call today. |
| SEC-001 | PASS | Fail-closed when no active company and not `allowAllCompanies` (`return {rows:[],materializedFacts:[]}` rather than leaking cross-company data). |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The report catalog itself is real, broad, and correctly scoped — this is
solid analytics coverage for a first pass. The missing piece is drilldown:
a report tells you *that* spend is concentrated somewhere, not which
specific purchase orders to look at. The `materializedFacts` half of every
report response is confirmed dead weight — either wire up whatever job was
meant to populate `procurement_reporting_facts`, or remove the unused
query entirely.
