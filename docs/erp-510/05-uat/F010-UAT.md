# F010 — Opportunity Pipeline UAT

## Gate

- Feature: F010 Opportunity Pipeline
- Technical status: TESTING
- UAT status before execution: NOT_READY
- Record tester name, date, organization, company, branch, role and evidence paths.

## Scenarios

1. Open `/crm/pipeline` as a CRM viewer and confirm the route is reachable without mutation controls when `crm.opportunities.manage` is absent.
2. As an authorized seller/manager, switch between at least two visible pipelines and confirm stages/cards from the other pipeline never remain mixed into the selected board.
3. Switch company/branch context and confirm cards outside scope disappear; test a restricted owner against another seller's Opportunity.
4. Create an open Opportunity in the selected pipeline and confirm it appears in the correct stage after refresh.
5. Move the card to another open stage by drag/drop and verify the card persists in the new stage after hard refresh.
6. Repeat the same movement using the per-card stage select with keyboard only.
7. Attempt to drop/select the current stage and confirm no extra business movement/history/outbox event is created.
8. Open the same Opportunity in two sessions, move it in session A, then attempt a stale move in session B. Confirm session B receives an actionable conflict and does not overwrite session A.
9. Attempt a cross-pipeline stage ID through the API and confirm a safe 409-style domain failure with no state change.
10. Move an Opportunity to a Won terminal stage. Confirm a Won reason is required, compatible reasons are shown, notes can be entered, and the card leaves the open pipeline after success.
11. Repeat for Lost and confirm a Lost/Both reason is required.
12. Test a terminal stage when no compatible active reason exists and confirm the UI blocks confirmation with an actionable message.
13. After Won/Lost, attempt to call the stage endpoint to reopen the Opportunity and confirm the service blocks it.
14. Open Opportunity detail and confirm its stage selector contains only stages from that Opportunity's pipeline.
15. Request stage-change approval, change the Opportunity before approval execution, and confirm stale expectations prevent overwriting the newer state.
16. Inspect `crm_opportunity_stage_history` for correct from/to stage, actor, probability, note and timestamp.
17. Inspect CRM outbox and audit evidence for exactly the committed transition; confirm same-stage replay adds no service history/outbox event.
18. Verify empty pipeline, no active stages, empty stage columns, API error/conflict and first-500 warning states.
19. Verify desktop, tablet and narrow mobile-width web layouts; horizontal board scrolling must not hide keyboard controls or close form actions.
20. Verify focus order, labels, select operation, status/error announcement and links with keyboard/screen-reader basics.
21. Rerun F001-F009 focused regressions and confirm Opportunity create/edit/archive/relationships remain intact.

## Acceptance

Mark UAT `READY` only when every applicable scenario passes and named evidence is recorded. Then, and only then, update `FEATURE_REGISTER.csv` to `COMPLETE,READY` and record tester/date/evidence in `UAT_REGISTER.csv`.
