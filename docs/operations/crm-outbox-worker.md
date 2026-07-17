# CRM outbox worker

Run the worker continuously under a supervisor:

```bash
pnpm crm:outbox
```

The worker claims rows with database locking, uses stable idempotency identifiers, applies consent checks, records delivery attempts, retries with backoff and moves exhausted work to a dead-letter state.

Production delivery fails closed when the selected provider is unsupported or unconfigured. Local and automated environments may use the deterministic fake provider. Monitor queue lag, failed rows and dead-letter rows and reconcile them before considering communication delivery healthy.
