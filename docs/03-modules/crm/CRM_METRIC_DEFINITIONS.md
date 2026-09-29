# CRM metric definitions (F024 · F025 · F030)

One set of pipeline and forecast measures serves the pipeline dashboard, its
drill-downs and breakdowns, the forecast, and CRM reports. They are defined in
code in one place and every consumer computes them from the same fact set:

| Piece | File |
|---|---|
| Measures, populations, dimensions (version `crm-metrics-2026.09`) | `services/api/src/modules/crm/pipeline-analytics-and-forecasting/metric-definitions.js` |
| Canonical opportunity fact set (visibility, attribution, currency) | `.../pipeline-analytics-and-forecasting/opportunity-facts.js` |
| KPIs, breakdowns, rollups, keyset drill-downs, quota | `.../pipeline-analytics-and-forecasting/pipeline-metrics.js` |
| Forecast rollup, submissions, snapshots, accuracy | `.../pipeline-analytics-and-forecasting/forecast-service.js` |
| Report datasets `crm.pipeline_analysis`, `crm.opportunity_records` | `services/api/src/orchestration/reporting/datasets.js` |

The CRM home dashboard's opportunity figures, and the `pipeline`, `forecast`
and `revenue-operations` catalogue reports, were rewired onto this layer; their
former inline SQL formulas were removed.

## Visibility

The fact set applies `recordScope()` for the opportunities resource: exactly
the rule the Opportunities list uses (company/branch, own + unassigned +
managed-team members, view-all). No aggregate can include a deal the caller
could not open. Dashboard scope `mine` / `team` only narrows it further.

## Populations and measures

Forecast categories are cumulative: **Commit** = committed; **Best case** =
committed + best case; **Pipeline** = every open deal not omitted.

| Metric | Population | Measure | Time basis |
|---|---|---|---|
| `open_opportunities` / `open_pipeline` / `weighted_pipeline` | status open | count / amount / expected revenue | current state |
| `closing_opportunities` / `closing_in_period` / `weighted_closing` | open, expected close in period | count / amount / expected revenue | expected close date |
| `commit` / `best_case` / `forecast_pipeline` | open, expected close in period, category rule above | amount | expected close date |
| `won_amount` / `won_count` | won, actual close in period | amount / count | actual close date |
| `lost_amount` / `lost_count` | lost, actual close in period | amount / count | actual close date |
| `win_rate` | won or lost in period | won ÷ (won + lost) × 100 | actual close date |
| `stalled_opportunities` | open, past the stage's stall threshold (SLA policy `maximum_days`, else stage `stale_after_days`; none = never stalled) | count | current state |
| `unassigned_opportunities` | open, no owner | count | current state |

Expected revenue is the stored generated column (amount × probability ÷ 100,
F011); it is converted like the amount.

**Reconciliation guarantee.** A drill-down's summary is computed by the same
statement shape over the same population as the KPI, so the drill-down total
equals the tile. Breakdown rows (by stage, owner, team, territory, source,
category, pipeline, close month) sum to the KPI. Proven against PostgreSQL in
`tests/integration/crm/pipeline-metrics-db.test.mjs` (golden dataset).

## Currency

- **Reporting currency** = the organisation's base currency.
- **Source** = `tenant.exchange_rates`, the dated rate table Accounting uses;
  the latest active rate on or before the valuation date, a company-specific
  rate preferred over an organisation-wide one.
- **Valuation date** = the actual close date for won/lost deals; the as-of date
  (today unless given) for open deals.
- **Precision and rounding**: amounts × rates are kept at full numeric
  precision; each aggregate is rounded once, half away from zero, to 2 decimals.
  Drill-down rows show each converted value rounded to 2 decimals.
- **Missing rate**: a deal is never added at face value. It is excluded from
  money totals, counted and listed as *unconverted* (with its currency), and
  still appears in drill-downs with no converted value.

## Team and territory attribution

Effective-dated on the as-of date, one value per deal, so hierarchy rollups
never double count:

- **Team** = the owner's primary sales-team membership: active seller/manager
  membership effective on the date, highest allocation, then earliest start,
  then team code.
- **Territory** = the deal's own primary territory assignment, else its
  account's, else its owner's.
- A team or territory filter includes all descendants.

## Quota (F020 targets)

Quota plans (`crm_quota_plans`, revenue or bookings) overlapping the period are
prorated by overlapping days and converted at the period end. Resolution never
double counts levels: an owner filter uses that user's plans; a team filter uses
the team's own plan, else the user plans of owners whose primary team is in the
subtree; a territory filter uses the territory's own plan; no filter sums
user-level plans. **Attainment** = won ÷ quota; **coverage** = closing in period
÷ (quota − won). Quota amounts are visible organisation-wide only with
`crm.revenue.manage` or `crm.analytics.manage` (or view-all); otherwise a seller
sees only their own.

## Forecast (F025)

- Live owner figures come from the measures above for the period dates.
- **Adjusted commit** = submitted commit (else system commit) + manager
  adjustment. An adjustment never changes an opportunity or the seller's number.
- **Rollup**: owner → primary team → parent teams → organisation; each owner is
  counted once; sums in integer cents.
- **Snapshots** store organisation, team and owner rows plus each owner's
  deals, immutable (database trigger), so history is reproduced, never
  recalculated.
- **Accuracy**: for each closed period, the snapshot at the horizon (the last
  capture on or before period start + horizon days, else the first capture)
  against the canonical Won metric for the period: error, absolute error,
  error %, and commit conversion (committed deals at capture that were won).
  Calibration = mean absolute % error, mean bias %, periods within 10 %.
