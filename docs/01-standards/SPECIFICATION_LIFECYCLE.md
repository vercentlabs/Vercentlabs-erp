# Specification Lifecycle — v3

Two independent axes are mandatory.

## Working status
`UNSPECIFIED -> RESEARCHING -> DRAFTING -> REVIEW_READY -> SPECIFICATION_READY`

## Readiness gate
`NONE -> RESEARCH_READY -> REQUIREMENTS_READY -> DESIGN_READY -> SPECIFICATION_READY`

| Gate | Minimum evidence |
|---|---|
| `RESEARCH_READY` | Domain research, official benchmark evidence, current-code audit targets/evidence |
| `REQUIREMENTS_READY` | Traceable subrequirements, workflows, business rules, edge cases, integrations and reversals |
| `DESIGN_READY` | Data/state/API/UX/security/responsive/accessibility architecture |
| `SPECIFICATION_READY` | Red-team review, tests, E2E, UAT, DoD and cross-reference validation |

Implementation and product readiness are tracked separately. No implementation work should be started for a capability until the governing feature dossiers and capability contract are specification-ready, except explicitly approved infrastructure repairs.
