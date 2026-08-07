# Capability Traceability

## Methodology (read this before the numbers)

CLAUDE.md treats "945 module-specific + 94 shared platform = 1,039 implemented requirements" as a **settled product decision** — this document does not re-audit or re-derive that total, and does not claim to. No enumerated list of 1,039 individually-named requirements exists anywhere in this repository; the one static feature register (`docs/VERCENTLABS_ERP_12_MODULE_FEATURE_REGISTER.md`) is explicitly flagged as unreliable and usable only as a terminology glossary (`docs/landing-redesign/phase-1/decision-log.md`, item 3).

`docs/landing-redesign/phase-1/information-architecture.md`'s own anti-cannibalisation rule states the correct granularity: *"No feature-level URL exists for any of the 1,039 individual requirements — they live as capability-group content inside their module page."* Following that rule, `packages/landing-content/src/capability-registry.js` operates at **capability-group** granularity — 73 real, evidence-grounded groups (67 module-specific + 6 shared-platform), each directly sourced from `docs/landing-redesign/phase-1/product-intelligence.md`'s per-module and shared-platform profiles. Each group carries a `requirementCount` — an honest **allocation** of the settled total across real, named groups, weighted by each group's relative depth as described in the evidence document (e.g., Accounting's 7 dense capability groups carry more of the 945 than Stock's 5 narrower ones). This is a structural presentation choice, not an independent re-count, and is documented as such here and in `decision-log.md`.

## Totals

| | Groups | Requirements |
|---|---|---|
| Module-specific | 67 | 945 |
| Shared platform | 6 | 94 |
| **Total** | **73** | **1,039** |

Verified by an automated test (`packages/landing-content/tests/module-content.test.mjs`, "capability registry sums to exactly 1,039") that fails the build if any future content edit breaks the total.

## By module

| Module | Capability groups | Requirements allocated | Public page |
|---|---|---|---|
| Accounting | 7 | 120 | `/modules/accounting` |
| CRM | 6 | 110 | `/modules/crm` |
| Procurement | 5 | 85 | `/modules/procurement` |
| Sales | 5 | 85 | `/modules/sales` |
| Manufacturing | 6 | 80 | `/modules/manufacturing` |
| Stock | 5 | 70 | `/modules/stock` |
| Quality | 6 | 70 | `/modules/quality` |
| HR & Payroll | 5 | 70 | `/modules/hr-payroll` |
| Support | 6 | 65 | `/modules/support` |
| Point of Sale | 5 | 65 | `/modules/point-of-sale` |
| Projects | 5 | 65 | `/modules/projects` |
| Assets | 6 | 60 | `/modules/assets` |
| **Total** | **67** | **945** | |

## By shared platform area

| Capability group | Requirements allocated | Public page |
|---|---|---|
| Tenant & multi-company structure | 18 | `/product/platform` |
| Roles & permissions | 20 | `/security` |
| Approvals & workflow engine | 18 | `/product/automation` |
| Audit trail | 12 | `/security` |
| Reporting, document & localization primitives | 16 | `/product/analytics` |
| Mobile device security & billing entitlement | 10 | `/product/mobile` |
| **Total** | **94** | |

## Validation

`packages/landing-content/tests/module-content.test.mjs` enforces, on every test run:
- The registry sums to exactly 1,039 (945 module + 94 platform).
- No duplicate capability-group IDs.
- Every group resolves to a real `publicPage` and a real `moduleId` or `platformArea`.
- Every module's own `capabilityGroups` total matches its registry entries exactly (the registry is derived directly from `modules.js`, so this is a consistency check against accidental drift, not two independent sources that could disagree).
- No module has fewer than 5 capability groups (the floor the brief specified).

## What this document is not

It is not a re-audit of whether 1,039 is the correct number, and it is not a literal enumeration of 1,039 named features with individual evidence citations. Both would require inventing detail the repository does not evidence at that granularity. What it is: a real, traceable mapping from the settled total down to 73 capability groups that are each individually evidenced in `product-intelligence.md` and individually visible on a real public page — the same discipline `product-evidence-register.md` (Phase 3) applied to screenshots, applied here to the requirement count.
