# Codex Independent Wave QA Protocol

Status: `MANDATORY_AFTER_GO5`

## Independence rule

Codex is the independent tester for a GO5 implementation candidate. It must not silently implement/fix the code it is evaluating. Its job is to find problems and prove user-visible behavior.

## Inputs

Codex must load:

- active wave row and feature IDs/capability groups;
- feature dossiers, semantic sub-capabilities, flows/states and UAT requirements;
- relevant cross-module journeys;
- current implementation/evidence;
- test accounts/fixtures/environment instructions available in the repo.

## Required test behavior

Test the wave as real users would, including:

1. primary role-based user journey for every feature;
2. alternate/exception path where specified;
3. permission-denied/record-scope behavior;
4. duplicate/retry/concurrency/stale-state behavior where applicable;
5. reversal/recovery/reconciliation where applicable;
6. downstream cross-module effects;
7. responsive desktop/tablet/mobile web behavior for all FULL_RESPONSIVE features;
8. accessibility/keyboard/focus on representative critical surfaces;
9. actual browser/API behavior in addition to automated test reruns;
10. no hidden data leakage through search/counts/errors/history/reports/jobs.

Use the repository's deterministic gates and Playwright/browser tooling where available. Do not declare PASS solely because unit tests pass.

## Result contract

Codex returns a report with:

- wave/commit/environment;
- features actually exercised;
- scenario-by-scenario PASS/FAIL;
- defects with exact steps, feature IDs, severity, expected vs actual result and evidence;
- tests/commands executed;
- coverage gaps/untestable items;
- final result: `PASS` or `FAIL`.

`PASS` requires no unresolved reproducible defect contradicting approved requirements/flows. An intentional limitation may remain only if the owner explicitly accepts it and the documentation is updated.

## Failure loop

On FAIL, record defects in `DEFECT_REGISTER.csv`, send the report back to ChatGPT for a fix command, rerun deterministic regressions and then rerun the **entire wave QA**. Do not advance to human UAT until Codex PASS.
