# Dependency-Aware Technical Implementation Waves

Status: `PASS_F_AUTHORIZED_BASELINE`

This document mirrors `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv`, which is the canonical wave-planning authority.

Noncanonical historical schemes using `T02–T15`, `W00`, or informal plain numeric labels such as `Wave 0`, `Wave 1`, or `Wave 2` are retired for active implementation scheduling. **Canonical zero-padded `W01–W15` identifiers remain active and unchanged.**

| Wave | Scope | Dependency rule |
|---|---|---|
| T00 | Technical safety foundation | first |
| T01 | Shared Platform + Experience Kernel | after T00 |
| W01 | Master-data foundation | after T00/T01 |
| W02 | Accounting + inventory primitives | after T00/T01/W01 |
| W03 | CRM | after T01/W01 |
| W04 | Sales | after W01/W02/W03 |
| W05 | Procurement + Stock | after W01/W02 |
| W06 | Finance integration | after W02/W04/W05 |
| W07 | Manufacturing + Quality | after W05/W06 |
| W08 | Projects + Assets | after W04/W05/W06 |
| W09 | Point of Sale | after W01/W02/W06 |
| W10 | Support / Customer Service | after W03/W04/W08 |
| W11 | HR & Payroll | after T01/W06 |
| W12 | Enterprise journey certification | after W03-W11 |
| W13 | ERP Copilot | after W12 |
| W14 | Enterprise hardening | after W12/W13 |
| W15 | Migration, pilot and production readiness | after W14 |

## Sequence versus dependency DAG

`sequence` is the canonical topological/reference ordering; it is not a global serialization mandate. `depends_on` is the authoritative eligibility gate.

After predecessor evidence has been reconciled and passed, multiple registered, non-overlapping Agent Work Packages may execute concurrently. The Project Manager still integrates and accepts one package at a time (`pm_integration_wip_limit=1`).

Parallel execution is governed by `PARALLEL_AI_IMPLEMENTATION_OPERATING_MODEL.md`, the execution/AWP/migration registers and their validators. It does not introduce dates, durations, effort estimates or delivery forecasts.
