# Shared Platform Reference Architecture

Status: `SPECIFICATION_READY`

Shared platform capabilities live primarily in protected `apps/web/src/core`, reusable `packages/*`, database platform/tenant primitives, `services/worker`, and server support under `services/api/src/core`. Business modules consume public platform contracts; they do not fork tenancy, authorization, audit, jobs, files, API, observability, accessibility or AI safety.

## Request path
`transport -> auth/session -> tenant/company/scope -> entitlement -> permission/record/field scope -> validation -> module/platform command -> DB transaction/RLS -> audit/outbox -> response`.

## Async path
`committed outbox/job -> trusted tenant metadata -> worker -> public command/integration -> bounded retry/backoff -> dead letter/exception -> reconciliation`.

PostgreSQL remains authoritative. Search/read models, mobile caches, analytics and AI retrieval are derived views and enforce the same tenant/field authorization. Authentication, authorization, tenant identity, audit identity and deterministic financial/stock/payroll/tax/payment truth are never delegated to AI.

A module cannot be `PRODUCT_READY` if a required SP dependency is not implemented/tested at the same release quality.
