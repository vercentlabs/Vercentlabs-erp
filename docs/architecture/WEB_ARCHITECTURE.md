
# Vercentlabs ERP Web Architecture

The ERP web application uses four application layers.

## 1. shared

`apps/web/src/shared`

Reusable, dependency-light primitives.

Allowed dependencies:

- npm packages
- workspace pure-data/pure-utility packages
- other shared code

Forbidden dependencies:

- `@/core`
- `@/orchestration`
- `@/modules`

Shared code must never know that CRM, Sales, Accounting or any other ERP
business module exists.

## 2. core

`apps/web/src/core`

Business-module-independent ERP platform infrastructure.

Examples:

- authentication
- sessions
- authorization
- tenant context
- company/branch access
- billing entitlement
- audit
- database access
- platform settings
- security
- module-access policy

Core may depend on shared.

Core must not import:

- `@/modules/*`
- `@/orchestration/*`

## 3. orchestration

`apps/web/src/orchestration`

Cross-module and platform-composition code.

Examples:

- My Work aggregation
- approvals spanning several modules
- cross-module exception aggregation
- integration dashboards that summarize module state

Orchestration may depend on:

- shared
- core
- public module adapters

## 4. modules

`apps/web/src/modules/<module>`

Business-domain application adapters and UI.

The twelve canonical ERP module roots are:

1. CRM
2. Sales
3. Procurement
4. Stock
5. Manufacturing
6. Quality
7. Projects
8. Assets
9. Point of Sale
10. Support
11. HR & Payroll
12. Accounting

## Request transport

`apps/web/src/app`

Next.js routing and transport only.

Pages and API routes should delegate business behavior rather than becoming
large domain implementations.

## Backend rule

A backend business module may call another business module only through its
public contract.

Public contract imports such as:

`../stock/index.js`

are allowed.

Imports into another module's private implementation files are forbidden.

Multi-step cross-module transactions belong in:

`services/api/src/orchestration`

## Database rule

Platform/control data belongs in:

`database/platform/migrations`

Tenant business data belongs in:

`database/tenant/migrations`

Runtime application/worker credentials must be restricted roles and must not
own application relations or bypass RLS.

## Development policy

The ERP is pre-production. Architectural correctness takes precedence over
preserving obsolete internal file names and compatibility layers.

Do not retain a bad internal structure merely because code already exists in
that location.
