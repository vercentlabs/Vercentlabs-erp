# CRM W03 — F001 final UAT sign-off

Status: **PENDING HUMAN EXECUTION**

This is the single human sign-off activity for F001. It is not another implementation pass.

## Front-line desktop journey

1. Sign in as a normal CRM representative with access limited to one permitted company/branch.
2. Create a Lead with source, contact details and owner; confirm duplicate detection behaves correctly for a near/exact duplicate.
3. Open Lead 360 and verify lifecycle, qualification, activities, notes/files, provenance/consent, SLA/data-quality and explainable score/AI sections show only permitted data.
4. Edit the Lead in two browser tabs. Save tab A, then save stale tab B; tab B must show a recoverable conflict and must not overwrite A.
5. Select a small group of Leads and perform a supported bulk change; verify per-record results. Then select all matching Leads above the async threshold and verify queued progress/result reporting.
6. Confirm the resulting Lead history/audit evidence explains actor, time and outcome.

## Front-line mobile/tablet journey

1. At a phone/tablet viewport, open the Leads workspace and Lead 360 without horizontal content loss.
2. Search/filter Leads, open one Lead, record a follow-up or supported high-frequency action, and return to the list without losing usable context.
3. Confirm touch targets, focus/labels and permission/error states remain usable.

## Manager exception / reconciliation journey

1. Sign in as a manager/operations user with broader—but not unrestricted—scope.
2. Review one enrichment/AI/data-quality or duplicate exception and apply only an explicitly authorized human decision.
3. Inspect a bulk job with a conflict/skipped item (or deliberately create a stale version) and confirm the result is visible and retryable without duplicate effects.
4. Verify restricted Leads outside the manager's permitted company/branch/record scope cannot be inferred from search, counts, detail, intelligence, job results or errors.
5. Confirm reporting/history reconciles with the visible Lead state.

## Sign-off evidence

Record:

- date/time;
- tester name/role;
- organization/company/branch used;
- desktop browser and mobile/tablet viewport/device;
- Lead IDs/job ID used for evidence;
- screenshots or screen recording for the stale-write and manager exception cases;
- PASS/FAIL for each section;
- blocker/defect IDs for any failure.

F001 may be marked COMPLETE only when the automated finalization command passes and this checklist has no unresolved blocking failure.
