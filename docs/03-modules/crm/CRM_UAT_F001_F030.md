# CRM human UAT checklist (F001–F030)

**Status: HUMAN UAT PENDING.** No step below has been executed by a human
tester. Automated evidence (unit, PostgreSQL, worker and browser tests) is
listed in `CRM_F001_F030_COMPLETION_MATRIX.md`; it does not replace this.

How to run: use a test organisation with the built-in roles below, one browser
per persona (plus a phone for the mobile rows). Record the result as PASS or
FAIL with a note; attach a screenshot or the audit/history entry where asked.
A FAIL blocks release of that feature.

Personas: **Seller** (Sales Representative), **Seller 2**, **Manager** (Sales
Manager of a team containing both sellers), **Head** (Sales Head),
**CRM Admin** (CRM Administrator), **Marketing** (Marketing Manager),
**Read-only** (Read-only User), **Guest** (no account; public booking).

| # | F-ID | Persona | Steps | Expected | Result | Tester / date | Notes |
|---|---|---|---|---|---|---|---|
| 1 | F001 | Seller | Create a lead; search it by name; open it; edit phone; reload | Lead saved, found, edit kept after reload, history shows the change | | | |
| 2 | F001 | Read-only | Open Leads; try to edit a lead | Read allowed, no edit action | | | |
| 3 | F002/F003 | Seller | Create an account and two contacts; set one primary | Both contacts under the account; primary shown | | | |
| 4 | F004 | CRM Admin | Add a lead source, deactivate an old one | Deactivated source not offered on new leads; old leads keep it | | | |
| 5 | F005 | Manager | Assign an unowned lead to Seller 2; try to assign to someone outside the team | First works with history; second refused | | | |
| 6 | F006 | Seller | Qualify a lead with the playbook | Qualification recorded with evidence | | | |
| 7 | F007 | Seller | Move a lead through stages; try a transition not allowed | Allowed moves only; time in stage shown | | | |
| 8 | F008 | CRM Admin | Create a duplicate lead; merge it | Warning on create; merge keeps history | | | |
| 9 | F009/F010 | Seller | Create an opportunity; move stage with the keyboard (no drag) | Stage moves; history recorded | | | |
| 10 | F011 | Seller | Change probability | Expected revenue = amount × probability ÷ 100 | | | |
| 11 | F012 | CRM Admin | Add a stage to a pipeline with live deals | Existing deals unaffected; new stage available | | | |
| 12 | F013 | Seller (phone) | Log a call from the mobile app, offline, then reconnect | Call appears once after sync | | | |
| 13 | F014 | Seller | Schedule a meeting with a contact; complete it with an outcome | Meeting on timeline with outcome | | | |
| 14 | F014 | Guest | Open the public booking link; book; reschedule; cancel | Only the host's free slots offered; confirmation; reschedule and cancel work; host sees the meeting | | | |
| 15 | F014 | Guest | Book two slots in quick succession from one browser more than 10 times in an hour | Later attempts refused ("Too many attempts") | | | |
| 16 | F015/F016 | Seller | Create a task and a follow-up with a reminder | Reminder notification arrives at the time | | | |
| 17 | F017 | Seller | Add a private note and an attachment | Seller 2 cannot see the private note | | | |
| 18 | F018 | Marketing | Open a lead's email history without sensitive access | Metadata only, no content | | | |
| 19 | F019 | Manager | Open a team member's lead timeline | Chronological, only items the manager may see | | | |
| 20 | F020 | Head | Create a team, set its manager, add members, create territory North with child Pune, assign North to the team | Coverage shows hierarchy, members, owner | | | |
| 21 | F020 | Manager | In Sales coverage, reassign two unassigned leads to Seller with a reason | Both reassigned; audit shows reason | | | |
| 22 | F020 | Seller | Open Sales coverage | "You don't have access" | | | |
| 23 | F021 | CRM Admin | Import a CSV of ~500 rows with 2 bad rows and 1 repeated email | Dry run shows the problems; import runs in background with progress; rejected-rows file downloads | | | |
| 24 | F021 | CRM Admin | Export leads; open in a spreadsheet a lead named `=1+1` | Cell shows `'=1+1` as text | | | |
| 25 | F022 | Seller | Convert a qualified lead; retry the conversion | One account, contact and opportunity only | | | |
| 26 | F023 | Seller | Convert to Quotation from an opportunity and save the quotation | Quotation linked to the opportunity (opportunity shows it) | | | |
| 27 | F024 | Manager | Dashboard: filter by the team; open Open pipeline | Drill-down total equals the tile; only team deals | | | |
| 28 | F024 | Manager | Add a USD deal with no exchange rate | Dashboard warns it is left out of totals | | | |
| 29 | F025 | Seller | Submit a forecast for the open period | Status "Waiting for review" | | | |
| 30 | F025 | Manager | Adjust the seller's commit with a reason | Adjusted commit shown; seller's number unchanged; history shows the adjustment | | | |
| 31 | F025 | Head | Take a snapshot, lock the period, try a new submission as Seller, close the period | Submission refused while locked; closed period cannot reopen; snapshots listed | | | |
| 32 | F025 | Head | After a closed period with a snapshot, open Accuracy | Forecast vs actual, error % and commit conversion shown | | | |
| 33 | F026 | Seller | Close a deal as lost with a reason; reopen it | Reason kept in history after reopen | | | |
| 34 | F027 | CRM Admin | Change a scoring rule; recalculate | Scores update; explanation shows the rule | | | |
| 35 | F028 | CRM Admin | Add a custom field and a tag; use both on a lead | Field saved and filterable; tag shown | | | |
| 36 | F029 | Manager | Bulk-assign 20 leads | All reassigned or per-row reasons shown | | | |
| 37 | F030 | Manager | Create a saved "Pipeline by owner" report; run it; download the CSV | Rows add up to the dashboard's Open pipeline | | | |
| 38 | F030 | Manager | Schedule it weekly to self and Seller | Seller's delivered copy contains only Seller's deals | | | |
| 39 | All | Any | Keyboard only through rows 1, 9, 21, 27, 29 at 200% zoom and on a 320 px wide window | Every step completes; focus visible; no horizontal scrolling of the page | | | |
| 40 | Mobile | Seller (phone) | Leads and Pipeline tabs with >100 records; Load more; search | Pages load; search is server-side | | | |

Sign-off (to be completed by the business owner after all rows pass):

| Role | Name | Date | Signature |
|---|---|---|---|
| Sales operations | | | |
| Sales management | | | |
| CRM administration | | | |
