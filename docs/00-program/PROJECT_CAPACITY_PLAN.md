# Project Capacity Plan

Status: `PM_BASELINE_FROZEN`
Accountable owner: `Project Manager`

The project has one accountable human: the Project Manager. AI agents are execution tools, not additional accountable project owners.

Capacity is governed by two separate WIP controls:

- **PM integration/acceptance WIP:** one package at a time;
- **AI execution WIP:** multiple registered work packages may execute concurrently only when dependency, path ownership, branch/base-commit, migration and shared-change controls pass.

Parallel AI execution does not create approval capacity. The Project Manager serializes integration/acceptance and remains responsible for scope, architecture, quality, risk and gate decisions.

Repository checkpoints and package evidence preserve context whenever project truth changes. No daily/weekly/monthly capacity assumption, effort hours, implementation duration, project start/finish date or delivery forecast is baselined.

Any change to accountability, integration WIP, parallel-execution controls or calendar commitments requires explicit Project Manager change control.
