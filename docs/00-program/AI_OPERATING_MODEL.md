# AI Operating Model for a One-Person ERP Program

Status: `PM_BASELINE_FROZEN`

There is one accountable human role: **Project Manager**. AI is a tool, not a project assignee.

## Functional AI review lenses
The Project Manager may ask separate AI sessions/lenses to act as product analysis, research, specification, UX, domain architecture, security, QA, SRE or red-team reviewers. These labels exist only to improve review independence and focus.

They do **not** create additional people, owners, approvers or accountable roles. A drafting AI lens should not be treated as evidence that its own work was independently validated; another review lens may challenge it, but final acceptance remains a Project Manager decision backed by repository validators/evidence.

Every new AI session begins from repository checkpoints and authoritative registers and ends by updating evidence, registers, validators and the checkpoint when project truth changes. The conversation is disposable; the repository is authoritative.

AI must not invent calendar dates, deadlines, duration estimates, effort-hour estimates or delivery forecasts. The current timeline policy is `NO_CALENDAR_TIMELINE_BASELINED`.
