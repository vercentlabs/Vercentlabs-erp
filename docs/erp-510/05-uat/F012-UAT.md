# F012 — Sales Stages UAT

## Readiness

- Feature status: TESTING
- UAT status: NOT_READY
- Named tester: pending
- Date: pending
- Environment/build: pending
- Automated evidence: F012 API/Web suites plus rolled-back PostgreSQL verifier

## Human scenarios

1. Open CRM Setup → Pipeline → Sales stages as a user with `crm.settings.manage`; verify the dedicated workspace loads.
2. As a CRM user without settings permission, verify the Sales Stages workspace and dedicated mutation APIs are inaccessible.
3. Switch companies and verify only organization-wide pipelines plus pipelines belonging to the active company are visible.
4. Switch pipeline in the workspace; verify only that pipeline's stages/history are shown.
5. Create an Open stage with name, probability, forecast category and stale-after days; verify stable generated code and persistence.
6. Attempt blank/overlong name, invalid probability precision/range, invalid stale days and `closed` forecast on Open; verify actionable errors.
7. Create a Won stage and verify probability is 100, forecast is Closed and stale-after is empty regardless of forged client values.
8. Create a Lost stage and verify probability is 0, forecast is Closed and stale-after is empty.
9. Attempt a second active Won or Lost stage in one pipeline; verify rejection without mutation.
10. Rename an unused stage; verify its code and pipeline remain unchanged.
11. Attempt to move a stage to another pipeline with a forged request; verify rejection.
12. Reorder Open stages with keyboard-operable up/down controls; verify sequence persists after refresh.
13. Attempt to place an Open stage after Won/Lost using a forged reorder request; verify rejection.
14. In two browser sessions, reorder/edit from one then submit the stale version from the other; verify conflict and no partial mutation.
15. Repeat an exact current update/reorder; verify no duplicate history/outbox/audit mutation.
16. Create an Opportunity using only a pipeline; verify the first active Open stage is selected, never a terminal stage.
17. Forge Opportunity creation directly into active Won/Lost; verify actionable rejection.
18. Change an Open stage default probability; verify an existing Opportunity in that stage keeps its stored probability/expected revenue until F010 movement or F011 override.
19. Move an Opportunity into the edited stage through F010; verify the destination probability is adopted and F011 expected revenue recalculates.
20. Try deactivating a stage with open Opportunities; verify rejection and that cards remain visible on the F010 board.
21. After moving open Opportunities elsewhere, deactivate the stage; verify it leaves active selectors/board but historical Opportunity/stage history labels remain readable.
22. Try deactivating the last active Open stage in a pipeline; verify rejection.
23. Reactivate an inactive stage; verify it returns to the active ordered catalogue and respects terminal uniqueness.
24. Attempt to change an already-used Open stage to Won/Lost (or terminal to Open); verify rejection preserving historical meaning.
25. Inspect recent configuration history and audit/outbox evidence for create/update/reorder/deactivate/reactivate; verify actor, stage/pipeline identity and no unnecessary customer PII.
26. Verify generic Web/mobile stage create/update/archive requests return the governed-API error and cannot bypass F012.
27. Desktop 1440×900: pipeline selector, list, drawer, actions and history are usable without clipping.
28. Laptop/tablet 1366×768 and 768px: layout remains usable and order/actions remain reachable.
29. Mobile 390px and 360px: drawer becomes full width, controls remain at least 44px and no horizontal page overflow blocks actions.
30. Keyboard/screen-reader basics: logical focus order, labelled pipeline/stage controls, Escape/dialog close, status/error announcements and order buttons work.
31. With reduced-motion preference, verify no essential workflow depends on animation.
32. Regression: F009 Opportunity create/edit/archive, F010 pipeline movement/terminal close and F011 probability/expected revenue continue to pass.

## Acceptance

Mark UAT `READY` only when every applicable scenario passes, there are no open P0/P1 defects, technical gates remain green and named tester/date/evidence are recorded. Then, and only then, update F012 to `COMPLETE,READY`.
