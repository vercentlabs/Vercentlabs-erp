# Vercentlabs ERP — Documentation

This directory holds the source of truth for the F001-F510 ERP and the SP001-SP036 shared-platform requirements it depends on, plus the standards and cross-module design references needed to implement them correctly. It does not carry a separate execution-process layer — implementation status is tracked in `PRODUCTION_TRACKER.md` and in the code itself.

## Source of truth (requirements — do not restate, only implement)

- `02-register/FEATURE_REGISTER.csv` — 510 canonical features across the 12 modules.
- `02-register/CAPABILITY_REGISTER.csv` — 98 capability groups the features roll up into.
- `02-register/FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv` — 4,080 semantic sub-capabilities.
- `02-register/SUBREQUIREMENT_REGISTER.csv` — 18,870 atomic requirements.
- `02-register/FEATURE_FLOW_REGISTER.csv` — 5,100 user/system flows.
- `03-modules/<module>/features/F###-*.md` — the 510 feature dossiers (one per feature, cited by ID from the registers above).

## Supporting technical references (kept because they're load-bearing design decisions, not process)

- `03-modules/<module>/architecture/`, `capabilities/`, `research/` — per-module reference architecture, permission matrices, journeys and capability packs.
- `04-shared-platform/requirements/SP001-SP036` — shared-platform requirements (tenancy, auth, permissions, billing, workflow, audit, etc.) that every module depends on.
- `04-cross-module/` — cross-module integration contracts (e.g. `ORDER_TO_CASH.md`, `PROCURE_TO_PAY.md`) describing how modules hand off to each other.
- `01-standards/` — engineering constitutions (database, API, security, tenancy/RLS, experience kernel, testing) that keep all 12 modules consistent.

## Current status

See `PRODUCTION_TRACKER.md` for the module-by-module production-readiness state.

## Rule zero

The 510 canonical F-IDs and 36 SP-IDs are traceability identifiers, not implementation folders. Code is organized by business capability under `apps/web/src/modules/<module>` and `services/api/src/modules/<module>`, one module per business domain, matching `docs/03-modules/`.
