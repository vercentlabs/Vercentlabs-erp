# Documentation Lifecycle and Cleanup Policy

Status: `ACTIVE`

The repository contains a large planning history. Future AI sessions must not read every document by default.

## ACTIVE authority — read first

- `docs/00-program/NEXT_CHAT_START_HERE.md`
- `docs/00-program/EXECUTION_PLAYBOOK.md`
- `docs/00-program/SOURCE_OF_TRUTH.md`
- `docs/00-program/EXECUTION_DASHBOARD.md`
- canonical registers in `docs/02-register/`
- relevant feature dossiers/capability packs/journeys/standards for the active wave
- current source and tests

## FROZEN specification/reference

510 feature dossiers, shared-platform requirements, architecture/security/database/UX/testing standards, capability/dependency/journey/traceability registers remain durable product authority.

## HISTORICAL evidence — do not bulk-load

Files named `*_PASS*_SPECIFICATION_REPORT.md`, `FINAL_PASS_*`, older pass-era UAT plans under `docs/08-uat/`, and prior current-code audit reports remain historical evidence. They are read only when a current authority references them or when investigating provenance.

## ACTIVE execution locations

- implementation plans/evidence: `docs/08-implementation-plans/`
- independent QA: `docs/09-test-plans/`
- final owner UAT evidence: `docs/10-uat/`

## Cleanup rule

Delete only a document proven to be an empty placeholder, generated duplicate, or fully superseded with no validator/reference dependency. Never delete a canonical feature dossier/register/standard merely to reduce file count.
