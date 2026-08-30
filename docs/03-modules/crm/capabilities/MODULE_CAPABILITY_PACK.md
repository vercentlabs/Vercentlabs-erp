# CRM Capability Pack

Status: `SPECIFICATION_READY`

Canonical range: F001–F030

## Capability contracts

### CRM-CAP-001 — Prospect and relationship master data
- Canonical features: `F001;F002;F003;F004;F008`
- Personas: `REP;SDR;MGR;OPS`
- Outcome: Trusted prospect/company/contact identity, provenance and data quality
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-002 — Lead lifecycle, qualification and prioritization
- Canonical features: `F005;F006;F007;F027`
- Personas: `REP;SDR;MGR;OPS`
- Outcome: Explainable routing, qualification, lifecycle governance and prioritization
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-003 — Opportunity and pipeline governance
- Canonical features: `F009;F010;F011;F012;F026`
- Personas: `REP;MGR;EXEC;OPS`
- Outcome: Governed commercial pursuit, stage flow, probability and outcomes
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-004 — Seller activity and follow-up workspace
- Canonical features: `F013;F014;F015;F016;F017;F018;F019`
- Personas: `REP;MGR;OPS`
- Outcome: Permission-safe calls, meetings, tasks, reminders, notes, email and timeline
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-005 — Sales organization and coverage
- Canonical features: `F020`
- Personas: `REP;MGR;OPS;ADMIN`
- Outcome: Effective-dated sales teams, territories and hierarchy semantics
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-006 — CRM data operations and customization
- Canonical features: `F021;F028;F029`
- Personas: `REP;MGR;OPS;ADMIN`
- Outcome: Safe import/export, tenant metadata customization and bulk operations
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-007 — CRM conversion and Sales handoff
- Canonical features: `F022;F023`
- Personas: `REP;MGR;OPS`
- Outcome: Transactional lead conversion and public-contract quotation handoff
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

### CRM-CAP-008 — Pipeline analytics and forecasting
- Canonical features: `F024;F025;F030`
- Personas: `REP;MGR;EXEC;OPS`
- Outcome: Permission-safe KPIs, reproducible forecasts and governed reports
- Boundary: the capability groups implementation/use cases without changing any canonical F-ID.

## Module invariants
- No direct private-table write into another module.
- Server authorization precedes business mutation.
- Import, bulk, automation and AI reuse the same domain commands as interactive UI.
- Historical stage/assignment/probability/conversion/forecast facts remain reproducible.
- F023 hands off to Sales F036 through a public contract; Sales owns quotation truth.
