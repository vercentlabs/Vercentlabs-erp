# Wave 1 — F001 Leads

Status: **IN PROGRESS**

## Purpose

Complete F001 Leads as a production end-to-end workflow without falsely completing the supporting CRM features it consumes. F004-F008 and F013-F018 retain independent acceptance gates.

## Pass 1 — authoritative mutation and scope hardening

This pass closes verified integrity gaps in the existing F001 implementation:

- Web and mobile Lead edit/archive use row-level locking plus an expected `updatedAt` token.
- manual owner assignment requires the loaded Lead version.
- Kanban and manual lifecycle moves require the loaded Lead version and return actionable conflict errors.
- operations/timeline Lead visibility composes active-company, active-branch and owner/view-all record scope.
- Lead merge locks source/target deterministically before durable replay lookup.
- Lead merge terminal-state checks use `record_status`, not lifecycle `status`.
- generic Lead editing no longer mixes owner reassignment with ordinary field edits.
- regression tests cover the API/domain and web propagation contracts.
- `@vercentlabs/api` now inherits `assignLeadOwner` from the canonical CRM module declaration instead of shadowing it with a weaker legacy package-root signature.

## Pass 2A — governance and recovery candidate

This candidate pass closes the F001 governance boundary before Lead-360 intelligence and scale work:

- repairs the existing `crm_lead_saved_views` schema/API mismatch by adding the audit columns already used by the route;
- adds governed private, sales-team and organization-shared Lead views with explicit sharing permission, active team membership checks and company/branch scope;
- adds `crm.leads.view_sensitive` and `crm.saved_views.share` permissions with role-template and database backfill;
- applies Lead sensitive-content projection to direct records and mutation/lifecycle/assignment responses;
- removes restricted contact fields from Lead search so counts cannot be used as a contact-data oracle;
- independently content-scopes Lead activities, communications, notes, files, score evidence, qualification evidence and duplicate signals;
- independently scopes Lead-related opportunities by company, branch and owner/view-all;
- composes Lead scope into intelligence, Calls, Meetings and Tasks, closing known-id side channels;
- composes Lead scope into generic AI predictions, enrichment jobs and data-quality scores, with AI feedback inheriting access through its parent prediction; mixed-case historical `entity_type` values are fail-closed;
- protects specialized notes/files/follow-up/qualification/score/custom-field/duplicate/validation APIs with the same sensitive-content permission;
- prevents hidden duplicate matches from exposing classification or matching signals;
- replaces prompt-based saved-view creation with an explicit responsive visibility/team form;
- adds recoverable stale-write states (`Refresh board` / `Review latest Lead`) rather than generic conflict text;
- truthfully surfaces restricted content in the Lead 360 instead of implying that hidden contact data does not exist.

Pass 2A is **candidate implementation only until the guarded installer completes DB validation, focused regressions, full API/Web tests, typecheck, lint, repository verification and full release verification on the actual repository**.

### Archive simulation evidence

Before packaging, the exact post-Pass-1 archive candidate was exercised with:

- complete API source tests: **308/308 passed**;
- complete Web source tests from the package working directory: **473/473 passed**;
- database structure validation: **34 platform migrations + 73 tenant migrations, 0 failures, 0 warnings**;
- modified TypeScript/TSX syntax parse: **27 files, 0 syntax errors**;
- platform foundation, architecture and Web-boundary validators: **PASS**.

These archive results are pre-install simulation evidence only. Authoritative Pass 2A acceptance still requires the guarded installer to run the repository DB validator, focused regressions, full API/Web suites, Web typecheck/lint, repository verification and full release verification on the user's actual checkout.

## F001 already present and retained

The current product already contains substantial F001 capability, including Lead collection/table, Kanban, server filtering/search, saved-view basics, create/edit/detail, lifecycle, assignment, qualification/scoring, duplicate detection/merge, activities, communications, notes/attachments, follow-up and conversion. Existing code is evidence, not automatic acceptance.

## Still required before F001 can be COMPLETE

1. Pass 2A governance/recovery must first pass the executed repository/release gates described above.
2. Primary Lead 360 acceptance for consent/provenance, enrichment review, SLA/data-quality and AI explanation surfaces (Pass 2B).
3. Large-volume bulk command strategy and measured performance evidence (Pass 2C).
4. Real browser E2E for happy path, permission denial, stale-write conflict/retry and conversion/merge behavior (Pass 2D).
5. Real PostgreSQL F001 concurrency/invariant certification (Pass 2D).
6. Human UAT on desktop and mobile, including manager exception workflows (Pass 2D).
7. Canonical register/readiness updates only after the above executed evidence passes.

## Completion discipline

This document does not mark F001, F004-F008 or F013-F018 COMPLETE. Each feature remains governed by its own end-to-end acceptance criteria.
