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
| Database round trip (SELECT 1), for scale | 30 | 1.4 | 2.1 | 2.2 | 1 | 4 |
| Leads list, first page of 50 (seller) | 30 | 34.5 | 46 | 90.6 | 3 | 81450 |
| Leads list, search 'Lead12' (admin) | 30 | 42 | 47.9 | 52.7 | 3 | 82758 |
| Contacts list, first page of 50 (admin) | 30 | 102.9 | 184.8 | 246.1 | 2 | 37519 |
| CRM home dashboard (admin) | 30 | 367.6 | 509.3 | 595.6 | 7 | 15046 |
| CRM home dashboard (seller) | 30 | 136.3 | 320.8 | 402.4 | 7 | 14532 |
| Pipeline dashboard: KPIs + stages + quota (admin) | 30 | 61.5 | 91.8 | 96.3 | 3 | 4824 |
| Pipeline dashboard, team subtree filter (admin) | 30 | 197.1 | 273.8 | 340.8 | 3 | 4852 |
| Pipeline dashboard (manager, team visibility) | 30 | 34.1 | 37.8 | 43.5 | 2 | 4722 |
| KPI drill-down, first page of 50 (admin) | 30 | 55.5 | 84.4 | 91.2 | 1 | 30873 |
| Report: pipeline by owner (canonical rollup) | 30 | 25.1 | 33.5 | 38.1 | 1 | 7010 |
| Report: forecast by owner (catalogue) | 30 | 59.7 | 78.3 | 105.3 | 2 | 8018 |
| Forecast workspace with hierarchy rollup | 30 | 40.5 | 54.2 | 55.1 | 8 | 24874 |
| Forecast snapshot capture (org+teams+owners+deals) | 10 | 224.1 | 270 | 270 | 65 | 505 |
| Forecast accuracy (closed periods) | 30 | 4.8 | 6.8 | 7.9 | 1 | 164 |
| Sales coverage overview | 30 | 71.7 | 92.4 | 118.5 | 9 | 12835 |
| Unassigned leads queue, first page | 30 | 5 | 6.1 | 6.4 | 1 | 11269 |
| Lead import dry run, 5,000 rows (stage + duplicates) | 5 | 895.8 | 1049.6 | 1049.6 | 8 | 3326 |
| Lead import worker chunk, 200 rows | 3 | 4682.1 | 5109.7 | 5109.7 | 2207 | 31 |

