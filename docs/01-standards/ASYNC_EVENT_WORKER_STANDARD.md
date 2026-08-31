# Async, Event and Worker Standard

Status: `ARCHITECTURE_FROZEN_PASS_E`

Authoritative state changes commit before asynchronous work is considered durable. When an async side effect must follow a mutation, the outbox/job trigger is written atomically with the authoritative transaction. Worker scope is derived from trusted persisted job/queue metadata or an already-authorized internal context, never a client-supplied tenant identifier.

Every handler declares idempotency classification, stable business/idempotency key where required, bounded retry/backoff, terminal/dead-letter behavior, correlation, observability, replay safety and reconciliation. A provider timeout after an uncertain payment/email/webhook outcome is not automatically a failure: status is reconciled with the provider before repeating an irreversible effect.

Workers call public platform/module contracts; service-role privilege is narrowly scoped and never permission to mutate arbitrary tenant tables.
