# Dependency-Aware Technical Implementation Waves

Status: `PASS_F_AUTHORIZED_BASELINE`

This document mirrors `docs/02-register/IMPLEMENTATION_WAVE_REGISTER.csv`, which is the canonical wave authority. Older T02-T15 or W00-W11 numbering is retired and must not be used for implementation sequencing.

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

Because one person executes the project, human WIP is limited to one wave. This is an execution-order rule only. No date, duration, effort estimate or delivery forecast is attached to the sequence.
