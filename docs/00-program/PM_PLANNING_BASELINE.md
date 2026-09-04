# Project Management Planning Baseline

Status: `APPROVED`
Accountable owner: `Project Manager`

## Baseline decision

Technical/product specification planning and Project Manager control planning are closed for implementation entry.

The baseline includes:

- frozen canonical scope and shared-platform authority;
- architecture and technical constitutions;
- enterprise journeys and test/UAT traceability;
- one sole accountable Project Manager;
- one canonical dependency-aware implementation-wave authority;
- `PM integration/acceptance WIP = 1`;
- registered dependency-safe parallel AI work packages for execution;
- centralized path ownership, branch/base-commit and migration-reservation governance;
- spend-control baseline;
- RAID, stakeholder, communications, procurement and change-control governance;
- migration, release/rollback, DR and pilot evidence gates.

## Planning truth versus runtime execution truth

`IMPLEMENTATION_WAVE_REGISTER.csv` and `IMPLEMENTATION_SEQUENCE_BASELINE.csv` are planning authority. Runtime status is separate and belongs to `IMPLEMENTATION_EXECUTION_REGISTER.csv`; agent assignment belongs to `AGENT_WORK_PACKAGE_REGISTER.csv`.

The repository contains implementation activity that predates the runtime register. Those waves start as `RECONCILIATION_REQUIRED`; file/code existence does not justify retroactive completion.

## Explicit no-timeline constraint

`NO_CALENDAR_TIMELINE_BASELINED`

This baseline does not set start dates, finish dates, deadlines, durations, effort hours or delivery forecasts. Sequence and milestones are evidence/dependency gates only. A future calendar commitment requires explicit Project Manager change control.

## Implementation entry

Dependency-aware implementation may proceed only through registered work packages whose canonical predecessor gates and package dependencies pass, whose ownership/migration controls validate, and whose branch/base commit is registered.

Before new parallel packages are opened, install the machine governance controls and reconcile the existing implementation state into the runtime execution register. Product readiness and production authorization remain separate future gates.
