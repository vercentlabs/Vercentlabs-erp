# Status Model

## Specification
`UNSPECIFIED -> RESEARCHING -> DRAFTED -> RED_TEAM_REVIEW -> SPECIFICATION_READY`

## Implementation
`NOT_STARTED -> FOUNDATION -> IMPLEMENTING -> TESTING -> IMPLEMENTED`

## Product readiness
`NOT_READY -> PARTIAL_UI -> FUNCTIONAL_UI -> RESPONSIVE -> UX_HARDENED -> E2E_VERIFIED -> PRODUCT_READY`

`IMPLEMENTED` never implies `PRODUCT_READY`.

<!-- EXECUTION_STATUS_EXTENSION:START -->
## Five-go / QA / acceptance execution extension

Wave implementation candidate progression:

`RECONCILIATION_REQUIRED -> GO1 -> GO2 -> GO3 -> GO4 -> GO5 -> CANDIDATE_COMPLETE -> CODEX_QA_PASS -> HUMAN_UAT_PASS -> ACCEPTED`

A Codex or human failure transitions to `DEFECT_LOOP`, then returns to full-wave Codex QA after the fix. `ACCEPTED` is explicit evidence state and is never inferred from code existence.
<!-- EXECUTION_STATUS_EXTENSION:END -->
