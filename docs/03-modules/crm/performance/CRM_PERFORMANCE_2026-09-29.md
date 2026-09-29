# CRM performance measurement — 2026-09-29

Measured by `node scripts/crm/measure-performance.mjs` against a real PostgreSQL
on the restricted runtime role, in a disposable organisation removed afterwards.
Each call runs inside a tenant transaction that is rolled back. Timings are
wall-clock in the calling process, including database round trips, on the
development machine (Windows host, PostgreSQL 16 in Docker). They are evidence
for this environment, not a production SLA.

Dataset: 10,000 leads, 10,000 accounts, 10,000 contacts, 3,000 opportunities (10% USD), 30,000 activities, 40 sellers in a 3-level team hierarchy.

| Operation | Iterations | p50 ms | p95 ms | p99 ms | Statements | Payload bytes |
|---|---:|---:|---:|---:|---:|---:|
| Database round trip (SELECT 1), for scale | 30 | 1.4 | 1.7 | 2 | 1 | 4 |
| Leads list, first page of 50 (seller) | 30 | 36.7 | 57.9 | 113.3 | 3 | 81326 |
| Leads list, search 'Lead12' (admin) | 30 | 58 | 120.2 | 139.4 | 3 | 82709 |
| Contacts list, first page of 50 (admin) | 30 | 371.1 | 1137 | 1575.9 | 2 | 37519 |
| CRM home dashboard (admin) | 30 | 614.5 | 1606.1 | 1818.5 | 7 | 15042 |
| Pipeline dashboard: KPIs + stages + quota (admin) | 30 | 108.2 | 184.2 | 261.3 | 3 | 4824 |
| Pipeline dashboard, team subtree filter (admin) | 30 | 201.4 | 489.9 | 656.5 | 3 | 4852 |
| Pipeline dashboard (manager, team visibility) | 30 | 55 | 164.3 | 217.1 | 2 | 4722 |
| KPI drill-down, first page of 50 (admin) | 30 | 102.7 | 411.4 | 417 | 1 | 30873 |
| Report: pipeline by owner (canonical rollup) | 30 | 84.8 | 235.3 | 278 | 1 | 7010 |
| Report: forecast by owner (catalogue) | 30 | 125.6 | 328.5 | 397.4 | 2 | 8018 |
| Forecast workspace with hierarchy rollup | 30 | 123.2 | 216.6 | 266.8 | 8 | 24874 |
| Forecast snapshot capture (org+teams+owners+deals) | 10 | 448.3 | 808.1 | 808.1 | 65 | 505 |
| Forecast accuracy (closed periods) | 30 | 19.9 | 30.1 | 33.7 | 1 | 164 |
| Sales coverage overview | 30 | 346.9 | 631.8 | 646.8 | 9 | 12835 |
| Unassigned leads queue, first page | 30 | 12.2 | 24.4 | 32.7 | 1 | 11261 |
| Lead import dry run, 5,000 rows (stage + duplicates) | 5 | 3333.8 | 5511.5 | 5511.5 | 8 | 3326 |
| Lead import worker chunk, 200 rows | 3 | 10367.5 | 13952.6 | 13952.6 | 2207 | 31 |

