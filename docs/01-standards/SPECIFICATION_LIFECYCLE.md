# Specification Lifecycle

This lifecycle prevents documentation prose from being mistaken for implementation readiness.

| Status | Meaning | Promotion gate |
|---|---|---|
| `UNSPECIFIED` | Skeleton only | Canonical identity exists |
| `RESEARCHING` | Domain/code/benchmark evidence being gathered | Research sources and current-code targets identified |
| `DRAFTING` | Requirements and contracts are being decomposed | Capability placement and requirement IDs exist |
| `REVIEW_READY` | Full dossier drafted | Schema validator passes; no material TBDs; traceability/registers synchronized |
| `SPECIFICATION_READY` | Approved implementation contract | Omission/red-team review passes; dependencies/journeys/security/tests/UAT are complete |

Implementation and product readiness are tracked separately. A specification can be `SPECIFICATION_READY` while implementation remains `NOT_STARTED`.

## Prohibited promotions
- Never infer `SPECIFICATION_READY` from file existence.
- Never infer implementation completion from an API route, table, or UI shell alone.
- Never mark product ready without end-user workflow, trusted server authorization, valid state transitions/data effects, integrations where applicable, auditability, automated verification and human UAT.
