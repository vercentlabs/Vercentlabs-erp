# Human UAT / Owner Acceptance Protocol

Status: `FINAL_GATE_AFTER_CODEX_PASS`

There are currently no external production users. The project owner is therefore the final human acceptance authority before a wave is accepted.

## Entry gate

Human UAT starts only when:

- GO1-GO5 are complete/candidate reconciled;
- required automated gates pass;
- independent Codex wave QA reports PASS;
- no unresolved blocking defect remains.

## Per-feature acceptance

For every feature in the wave, the owner must actually use the product and confirm, as applicable:

- primary user job works end to end;
- data/state/history/audit are correct;
- permissions and scope match the role;
- important error/exception/retry/reversal behavior is understandable and recoverable;
- responsive behavior is usable;
- downstream effects/reports/reconciliation match expectations.

Record PASS/FAIL per feature in `FEATURE_EXECUTION_STATUS.csv` and keep supporting evidence under `docs/10-uat/evidence/<wave>/`.

## Failure

Any owner-found defect reopens the defect loop. ChatGPT generates the fix command; automated regression passes; Codex re-tests the full wave; then human UAT resumes.

## Approval

A feature becomes `OWNER_APPROVED` only after explicit owner PASS. A wave becomes `ACCEPTED` only after all applicable features/capabilities/journeys are approved and the canonical runtime exit gate is reconciled to PASS.
