# Sole Project Manager Operating Model

Status: `PM_BASELINE_FROZEN`

Sole accountable human role: `Project Manager`.

No developer, architect, QA engineer, UX designer, security specialist, intern, co-founder, vendor or AI agent is assigned project accountability by this baseline.

The Project Manager owns scope, requirements, architecture governance, dependency sequencing, integration/acceptance, quality, testing/UAT governance, RAID, security governance, stakeholder engagement, communications, procurement decisions, change control, migration/release readiness and gate decisions.

AI agents may execute registered work packages through architecture, security, UX, QA or domain lenses. Those functions are not approvers or accountability transfers.

## Work control

- PM integration/acceptance WIP limit: `1` package at a time.
- Multiple AI work packages may execute concurrently only under `PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md`.
- Canonical predecessor evidence and package dependencies must pass before a package becomes ACTIVE.
- Active package paths must not collide; migrations require reservations; shared changes require dedicated integration/shared-platform ownership.
- One package = one isolated branch/worktree pinned to an explicit base commit.
- Integration is serialized and revalidated against current main.
- Package closure never automatically completes a canonical wave.
- No calendar dates, deadlines, durations, effort-hour estimates or delivery forecasts are created by this baseline.

Final acceptance remains a Project Manager decision backed by repository evidence and validators.
