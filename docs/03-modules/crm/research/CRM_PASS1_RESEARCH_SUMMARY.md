# CRM Pass 1 Research Summary — F001–F030

Research date: 2026-08-30

## Evidence basis
Official documentation from Salesforce, Microsoft Dynamics 365 Sales, HubSpot, Zoho CRM and Odoo 19 was compared against the current repository snapshot. Primary findings are materialized in `docs/02-register/BENCHMARK_REGISTER.csv`; current-code evidence is in `EVIDENCE_REGISTER.csv` and `docs/06-current-code-audit/latest/CRM_PASS1_CODE_AUDIT.md`.

## Enterprise target
Vercentlabs CRM combines governed lifecycle/security patterns, high-frequency seller usability, configurable data/process behavior and ERP-native cross-module boundaries. Existing source code is evidence to audit, never proof of completeness by itself.

## Cross-cutting findings
- Data quality is cross-cutting across capture, import, duplicate detection, conversion and reporting.
- Time-in-stage and immutable stage events are first-class analytical facts.
- Opportunity probability/expected revenue and managerial forecast are separate concepts.
- Email/message content may require stricter visibility than the parent CRM record.
- AI predictions require provenance/explanation and cannot become a second permission system.
- Manager overrides preserve original values/history.
- Critical seller workflows need desktop/tablet/phone behavior; administration may remain desktop-first.
- F023 preserves a strict CRM-to-Sales quotation boundary.
