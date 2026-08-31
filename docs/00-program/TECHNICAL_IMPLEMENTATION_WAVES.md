# Dependency-Aware Technical Implementation Waves

Implementation is capability-based, never F001 -> F510 sequential coding.

| Wave | Scope | Required exit evidence |
|---|---|---|
| T00 | Architecture, coding constitutions, Experience Kernel | architecture validators + no unresolved ownership decisions |
| T01 | Tenant/auth/session/RBAC/scope/audit platform | cross-org DB/RLS + permission-negative tests |
| T02 | Jobs/outbox/files/notifications/search/import-export/API-webhook/observability | retry/idempotency/DLQ/security tests |
| T03 | Shared master data + money/UOM/currency/tax primitives | data invariants and migrations |
| T04 | Ledger, stock-ledger/reservation and other deterministic primitives needed by downstream modules | property/golden/concurrency tests |
| T05 | CRM + Sales capability packs | Lead/Order-to-Cash upstream stages |
| T06 | Procurement + Stock capability packs | Procure-to-Pay operational stages + reconciliation |
| T07 | Accounting backbone and Sales/Procurement/Stock postings | balanced posting, period locks, subledger reconciliation |
| T08 | Manufacturing + Quality | Plan-to-Produce + atomic quality hold |
| T09 | Projects + Assets | Project-to-Cash + Asset-to-Books |
| T10 | POS | payment uncertainty/offline/stock/accounting reconciliation |
| T11 | Support | Service-to-Resolution |
| T12 | HR & Payroll | Hire-to-Payroll-to-Books + statutory/effective-date golden tests |
| T13 | Enterprise journey certification | failure/retry/reversal/reconciliation E2E + UAT |
| T14 | Product AI/Copilot | authorization/eval/provenance/approval/kill-switch |
| T15 | Enterprise hardening/pilot | security, load, accessibility, DR restore, migration rehearsal, pilot/rollback/hypercare |
