# CRM Pass 1 Workspace Wireframes

These are durable low-fidelity specification wireframes. They define information hierarchy and responsive behavior, not final pixel styling.

## Desktop — list/work queue + 360
```text
┌ CRM nav ─────────────────────────────────────────────────────────────────────────┐
│ Leads / Accounts / Contacts / Opportunities / Activities / Forecast / Reports    │
├ Filters & saved view ────────────────┬ Record 360 / context drawer ──────────────┤
│ Search  Owner  Stage  Team  More     │ Identity / state / owner / primary action │
│ KPI strip / work queue context       │ Highlights + process path                 │
├──────────────────────────────────────┤ Related / timeline / notes / comms         │
│ Dense authorized rows                │ Audit / history / insights                 │
│ ...                                  │                                             │
└──────────────────────────────────────┴─────────────────────────────────────────────┘
```

## Tablet
List and 360 become a master-detail pattern; filters move into a drawer; primary actions stay sticky; no critical field depends on hover.

## Phone
```text
[CRM] [Search]
[Record / queue title]
[Primary action]
[State + owner + next action]
[Cards: identity / qualification / activity / related]
[Timeline]
[More actions]
```
Dense tables become cards; pipeline columns may scroll but every stage move has a menu/select alternative.

## Pipeline board
Cards show deal name, account, amount/currency, owner, close date, aging/risk. Drag is optional; keyboard/menu stage movement is equivalent and validates the same command.

## Activity workspace
Today / Overdue / Upcoming groups; task/call/meeting quick actions; sensitive email/thread content is separately permission-gated.

## Forecast
Expandable hierarchy grid with period/category/target/submission/adjustment/snapshot columns; drill-down opens underlying authorized opportunities without changing them.

## Required states
Every major workspace specifies loading, empty, validation error, service error, permission denied, stale/conflict, partial background-job failure and no-results states. Focus moves to the error/result summary predictably.
