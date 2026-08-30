# Observability Standard

Every important write path defines correlation/request IDs, structured logs, business metrics, technical metrics, trace/span boundaries where useful, background-job visibility, retries/dead-letter or exception queues, reconciliation diagnostics and operator-support evidence. Sensitive values must not be leaked into logs.

For critical journeys, observability must answer: what happened, to which business object, under which tenant/company/branch, who or what initiated it, what downstream effects were attempted, whether the effect is retryable, and how an operator can reconcile it.
