# Pre-Production Evolution Policy

Status: `ACTIVE_UNTIL_PILOT`

There are currently no external production users whose live workflows must be preserved. This is a deliberate engineering advantage.

## Default decision rule

When choosing between preserving weak existing behavior and replacing it with a demonstrably better architecture/domain model/UX, prefer the better solution **provided that**:

- canonical F001-F510/SP001-SP036 product intent is preserved or deliberately improved through documented change control;
- data integrity/security/tenant isolation are not weakened;
- migration history is preserved and any destructive data change is explicit/reversible where practical;
- tests, docs and evidence are updated with the new truth;
- cross-module public contracts are updated coherently.

## What is not protected before pilot

Accidental UI layouts, internal file paths, experimental APIs, duplicated CSS, placeholder compatibility shims and unapproved technical debt do not receive permanent compatibility status merely because they already exist.

## What remains protected

Security boundaries, auditability, deterministic financial/inventory/payroll rules, migration history, secrets, legal/compliance obligations, explicit public integration contracts and approved product requirements remain controlled changes.

This policy must be revisited before W15/pilot/production readiness.
