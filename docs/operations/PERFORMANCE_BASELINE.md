# Performance baseline

A **regression baseline**, not a capacity statement. It exists so a release
that makes the common paths slower is noticed. Numbers from a laptop say
nothing about production capacity; production sizing comes from the Cloud SQL
connection budget (`infrastructure/terraform/README.md`) and Cloud Monitoring.

## How to run

```bash
# Against any running environment (staging, or a local production image):
BASE_URL=https://erp.staging.example.com ORIGIN=https://erp.staging.example.com \
EMAIL=<smoke/perf user> PASSWORD=<password> [API_KEY=<v1 key with platform.context.read>] \
VUS=5 DURATION=60s pnpm perf:baseline
```

`pnpm perf:baseline` runs `scripts/perf/k6-baseline.js` in the pinned k6
container and writes a JSON summary to `reports/perf/`. One sign-in happens in
`setup()` (sign-in is rate limited by the application, 10 per 5 minutes per
IP, on purpose); every virtual user then loops over:

| Scenario | Request |
| --- | --- |
| workspace bootstrap | `GET /api/workspace/companies`, `GET /api/notifications?status=unread` |
| CRM list | `GET /api/crm/leads?limit=25` |
| search | `GET /api/search?q=e2e` |
| Sales order read | `GET /api/sales/orders?limit=25` |
| Stock balance read | `GET /api/inventory/stock/balances` |
| one safe write | `PATCH /api/notifications` (mark own notifications read; idempotent) |
| API v1 | `GET /api/v1/platform/context` (only when `API_KEY` is set) |

Thresholds (the run fails above them): error rate < 1 %, read p95 < 1.5 s,
write p95 < 2 s. Database pool saturation is read from the web's `db.pool`
log events during the run: `waiting > 0` means the pool was exhausted.

## Recorded baseline

| | |
| --- | --- |
| Date / commit | 2026-09-26, `11a8fa37` |
| Target | production web image (`NODE_ENV=production`, strict web role, enforced billing), local PostgreSQL 16, one container, `DATABASE_POOL_MAX=10` |
| Machine | developer laptop (Windows, Docker Desktop); load generator on the same machine |
| Load | 5 virtual users, 60 s, E2E fixture organisation (small data set) |

| Metric | Value |
| --- | --- |
| Requests | 918 (14.8/s), 131 iterations |
| Errors | 0 % |
| Sign-in (setup, 1 request) | 194 ms |
| Reads | p50 156 ms · p95 423 ms · p99 624 ms · max 941 ms |
| Safe write | p50 108 ms · p95 202 ms · p99 241 ms |
| DB pool | peak 4 of 10 in use, 0 waiting |

API v1 was not included in this run (no API key issued for the fixture).

## Reading a regression

Compare a new run with the table above on the same kind of target. A p95
increase of more than ~50 % on the same data set, any error rate, or
`db.pool` waiting > 0 is worth investigating before release: check Query
Insights (Cloud SQL) or `EXPLAIN` in a controlled test database, and the
indexes the path relies on.
