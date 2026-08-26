# F007 UAT — Lead Stages and Statuses

Status: **NOT_READY** until every required row has a named tester, date and evidence.

## Preconditions

- Use two organizations, multiple companies/branches, an owner, manager and representative.
- Have active, archived and converted Leads; qualified and unqualified Leads; assigned/unassigned Leads and an inactive historical stage.
- Record browser, database/audit/outbox evidence without exposing customer PII.

## Functional matrix

| ID | Scenario | Expected |
|---|---|---|
| 1 | Create a Lead manually, via public capture, CSV and offline sync | Every Lead begins at the configured New stage; supplied lifecycle fields cannot forge another value. |
| 2 | Rename New | Existing Leads immediately show the new label while stored code remains `new`. |
| 3 | Create and reorder a custom stage | Unique stable code is generated; ordering is deterministic in Setup, tabs, Detail and Kanban. |
| 4 | Duplicate a stage name using case/space variants | Save fails inline and no stage/outbox/audit mutation occurs. |
| 5 | Deactivate a used non-initial stage | Existing Leads keep/read it; it cannot receive new transitions; no Lead is mass-moved. |
| 6 | Reactivate the stage | It returns to active targets in configured order. |
| 7 | Attempt to deactivate New | Action is blocked because an active initial stage is required. |
| 8 | Move New → Contacted → Working and backward | Only explicit adjacent moves succeed; labels and timeline update. |
| 9 | Drag a Kanban card to a legal target | One move commits and board refreshes after success. |
| 10 | Drag to an illegal/inactive target or simulate API failure | Card stays in its original column and a useful message is announced. |
| 11 | Use Move Lead with keyboard/touch | Same legal transitions work without drag/drop. |
| 12 | Re-submit the current stage | No Lead write, history, audit or outbox event occurs. |
| 13 | Race two transitions with the same timestamp | One valid serialized result commits; stale request receives conflict guidance. |
| 14 | Move archived or converted Lead | Action is blocked; lifecycle/history remains readable. |
| 15 | Move qualified/unqualified, assigned and sourced Leads | Qualification, score, owner and source remain unchanged. |
| 16 | Transition a Lead | Exactly one immutable history row, one platform audit and one `crm.lead.stage_changed` outbox row exist. |
| 17 | Generic PATCH, bulk, mobile and direct SQL mutation | Each is rejected or cannot forge lifecycle; direct SQL hits the database guard. |
| 18 | Cross-organization/stale/inaccessible IDs | Safe not-found/conflict response; no mutation or identifier leakage. |
| 19 | CRM viewer vs Lead manager vs Settings manager | Viewer reads; Lead manager transitions; Settings manager configures; unauthorized actions are absent/rejected. |
| 20 | F001–F006 regression | Lead CRUD/archive/conversion, Accounts, Contacts, Sources, Assignment and Qualification remain correct. |

## Responsive and accessibility matrix

Test Setup, Lead list/Kanban, create drawer and Lead detail at 1920×1080, 1536×864, 1440×900, 1280×800, 1024×768, 834×1194, 768×1024, 430×932, 390×844, 360×800 and 320×568.

Confirm no document overflow, clipped action, overlapping text, undersized practical target or unreachable card. Verify keyboard tab order, visible focus, Enter/Space actions, native select operation, drawer focus containment/Escape/restoration, screen-reader labels/live errors, text plus colour state, 200% zoom and reduced motion.

## Sign-off

| Area | Tester | Date | Evidence | Result |
|---|---|---|---|---|
| Functional |  |  |  | Pending |
| Permissions and isolation |  |  |  | Pending |
| Database/audit/outbox/concurrency |  |  |  | Pending |
| Desktop/tablet/mobile visual |  |  |  | Pending |
| Keyboard/screen reader/zoom |  |  |  | Pending |

F007 may move to COMPLETE/UAT READY only after all rows pass with named-human evidence.
