# ERP Worker

`@vercentlabs/worker` is the durable background execution process for the ERP.

## Responsibilities

- durable PostgreSQL-backed jobs
- retry/backoff and dead-letter behavior
- idempotency-key deduplication
- tenant-scoped execution
- webhook delivery
- SSRF protection for outbound webhooks
- scheduled system jobs
- structured logging and correlation

## Structure

```text
services/worker/
├── bin/
│   └── start.mjs
├── src/
│   ├── db.js
│   ├── queue.js
│   ├── registry.js
│   ├── worker.js
│   ├── scheduler.js
│   ├── backoff.js
│   ├── outbox.js
│   ├── ssrf.js
│   ├── webhook-delivery.js
│   ├── system-context.js
│   └── handlers/
└── tests/
```

The worker is a standalone process. The web application must never start it.

Module-specific asynchronous behavior belongs in `src/handlers/`; the queue,
retry, tenancy and delivery infrastructure remains module-neutral.
