# Implementation state

Durable state for the full-completion program. Read in this order to resume without redoing the audit:

1. `session-handoff.md` - branch, commit, what is done, exact next task.
2. `current-state.md` - what the repository actually contains (measured, not claimed).
3. `blocker-register.md` - external blockers.
4. `execution-plan.md`, `architecture-decisions.md`, `test-evidence.md`, `release-readiness.md`.

Generated evidence (do not edit by hand; rerun `node scripts/ux/build-implementation-inventory.mjs`):

| File | Content |
|---|---|
| `counts.json` | Register counts, route counts, status tallies, tied to a commit |
| `routes.csv` | Every navigation registry entry: declared status, whether a page resolves, e2e specs that mention it |
| `feature-status.csv` | One row per feature (510) with source/test evidence found |
| `requirement-matrix.csv` | One row per requirement (18,870) inheriting its feature's status |

## Status vocabulary

`NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED_COMPLETE`, `BLOCKED_EXTERNAL`, `NOT_APPLICABLE` (with a written reason).

The generator never writes `VERIFIED_COMPLETE`. It reports at most `IMPLEMENTED_UNVERIFIED` because it can only see that source cites a feature and a route resolves. A requirement becomes `VERIFIED_COMPLETE` only when its acceptance test passes on the recorded commit and the evidence is linked in `test-evidence.md`. Zero requirements are currently `VERIFIED_COMPLETE`.

`feature-status.csv` reads `NOT_STARTED` for a feature that no source file cites by id. That means "no evidence found", not "missing": a feature can be built without citing its id. Those rows need review, not building.
