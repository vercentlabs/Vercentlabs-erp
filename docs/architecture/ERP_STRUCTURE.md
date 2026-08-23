# ERP Architecture

## Style

Vercentlabs ERP is a modular monolith with explicit domain boundaries and vertical capability slices. It is not twelve microservices.

## Dependency direction

```text
platform core
    ↑
business modules
    ↑
cross-module orchestration
    ↑
web/API transports and workers
```

All request paths must preserve the existing access chain: authentication → organisation → module enablement → billing entitlement → role/permission → company scope → branch scope → record scope → business rule → transaction/audit.

## Module boundaries

The permanent business-module set is CRM, Sales, Procurement, Stock, Manufacturing, Quality, Projects, Assets, Point of Sale, Support, HR & Payroll and Accounting.

A module owns its private repository/rules/calculation code. Another module may depend only on its public contract. Do not write directly into another module's tables from new code; introduce an owning-module command or an orchestration workflow.

## Capability structure

As existing large module roots are touched, split them incrementally by capability rather than by arbitrary line count. A typical capability can contain `commands`, `queries`, `repository`, `rules`, `validation`, `events`, and a narrow `index`. Do not mechanically split currently-working 2,000–3,000 line services without feature-level regression coverage.

## Database

`database/platform` contains platform/SaaS identity and access state. `database/tenant` contains ERP operational state. Tenant tables remain organisation-scoped and RLS-enforced. Migration identity is the full ordered filename plus a SHA-256 checksum recorded in `public.schema_migrations`.

Runtime database grants are provisioned centrally and are not embedded in feature migrations.

## 510-feature program

`docs/erp-510` is the requirement/evidence workspace. Feature documents do not dictate one-directory-per-feature source layout. New source code is organised around durable business capabilities so future features can be added without restructuring the repository again.
