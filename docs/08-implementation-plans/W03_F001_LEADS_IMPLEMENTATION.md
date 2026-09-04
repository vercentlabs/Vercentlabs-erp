# W03 / F001 — Leads Implementation

Canonical implementation wave: `W03` (CRM). Historical internal pass labels below are evidence labels only and do not define implementation sequencing.

Implementation evidence status: **IN PROGRESS (PRE-GOVERNANCE)** — runtime wave/package status is controlled only by the execution/AWP registers after reconciliation.

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

## Pass 2B — Lead 360 governance and intelligence candidate

This candidate composes the already-present F001 governance/intelligence data model into the primary Lead 360 and closes two specialized authorization gaps discovered while tracing the workflow end to end:

- adds a shared `Governance & AI` Lead 360 section for provenance, immutable consent history/recording, SLA state/actions, data-quality signals, enrichment review and explainable AI;
- supports per-field enrichment acceptance so human reviewers can apply only trusted proposed changes;
- displays deterministic score model/version/contributions and labelled AI prediction provider/model/version evidence;
- reuses the existing provenance, consent, enrichment, SLA, data-quality and AI tables/services instead of creating duplicate storage;
- prevents Lead enrichment queue/review from bypassing sensitive-content and company/branch/owner record scope through known entity/review IDs;
- applies same-origin protection to the specialized enrichment mutation route;
- prevents generic `consent-events` list/create from exposing or writing Lead-linked consent evidence outside the same Lead privacy and record-scope boundary;
- deliberately excludes raw provenance `original_payload` from Lead 360 composition.

Detailed scope and verification are recorded in `W03_F001_GOVERNANCE_INTELLIGENCE_MANIFEST.md`. Pass 2B remains **candidate implementation only** until the guarded installer completes focused regressions plus the full repository/release gates on the actual checkout.

## F001 already present and retained

The current product already contains substantial F001 capability, including Lead collection/table, Kanban, server filtering/search, saved-view basics, create/edit/detail, lifecycle, assignment, qualification/scoring, duplicate detection/merge, activities, communications, notes/attachments, follow-up and conversion. Existing code is evidence, not automatic acceptance.

## Finalization & certification — the only remaining F001 delivery unit

The historical 2A/2B labels above are retained as implementation evidence, but F001 no longer creates additional named micro-passes. The remaining work ships and is accepted as one finalization unit:

- large-volume Lead bulk operations use synchronous per-record commands only for small selections and durable asynchronous jobs for larger/filter selections;
- filter selections are snapshotted with optimistic versions so later filter drift cannot change job membership;
- async execution re-authorizes the initiating user at execution time and processes resumable bounded batches with durable per-item results;
- Lead list ordering is deterministic and scale-oriented indexes cover active/owner/follow-up/source work queues;
- the operations dashboard uses scoped SQL aggregation instead of materializing all Leads in application memory;
- a live PostgreSQL verifier measures representative 50k-row detail/list/dashboard/mutation thresholds and rolls its fixture transaction back;
- focused API/Web/worker regressions, DB/architecture validators and the full repository release gate run in the same closeout command;
- browser/API critical-journey evidence, PostgreSQL concurrency/invariant evidence and the required desktop/mobile human UAT remain acceptance evidence inside this same finalization unit rather than becoming another “Pass 2D”.

F001 becomes COMPLETE only when that finalization evidence is executed successfully on the real checkout and the human UAT items are signed off.

## Completion discipline

This document does not automatically mark F001 or F002–F008 COMPLETE. After F001 certification, implementation proceeds directly into CRM W03 Batch A (`F002–F008`) under `CRM_W03_EXECUTION_PLAN.md`, with one batch candidate and one certification gate rather than per-feature pass chains.
