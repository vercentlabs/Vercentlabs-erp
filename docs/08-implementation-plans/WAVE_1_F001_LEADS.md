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

## F001 already present and retained

The current product already contains substantial F001 capability, including Lead collection/table, Kanban, server filtering/search, saved-view basics, create/edit/detail, lifecycle, assignment, qualification/scoring, duplicate detection/merge, activities, communications, notes/attachments, follow-up and conversion. Existing code is evidence, not automatic acceptance.

## Still required before F001 can be COMPLETE

1. Shared/team saved-view governance and permission model, not user-private views only.
2. Sensitive Lead field/content visibility policy beyond record-level visibility.
3. Primary Lead 360 acceptance for consent/provenance, enrichment review, SLA/data-quality and AI explanation surfaces.
4. Large-volume bulk operation strategy and measured performance evidence.
5. Real browser E2E for happy path, permission denial, stale-write conflict/retry and conversion/merge behavior.
6. Real PostgreSQL F001 concurrency/invariant certification.
7. Human UAT on desktop and mobile, including manager exception workflows.
8. Canonical register/readiness updates only after the above executed evidence passes.

## Completion discipline

This document does not mark F001, F004-F008 or F013-F018 COMPLETE. Each feature remains governed by its own end-to-end acceptance criteria.
