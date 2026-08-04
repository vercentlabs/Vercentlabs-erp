# CRM-07 — Marketing execution and attribution

CRM-07 completes the eight benchmarked marketing capabilities CRM-064 through CRM-071.

## Delivered workflows

- Static and dynamic audiences with allowlisted, parameterized segment evaluation.
- Campaign membership progression and consent-aware email/SMS delivery queues.
- Frequency caps, quiet hours, suppression and unsubscribe enforcement.
- Multi-step journeys with waits, conditions, branches, exit criteria and durable enrollments.
- Deterministic A/B and multivariate assignment with governed result counters.
- First-touch, last-touch, linear, position-based and time-decay attribution.
- Native event/webinar publishing, capacity-aware registration, attendance and follow-up metadata.
- Survey schemas, public response tokens, required-answer validation, score and sentiment analytics.
- Marketing dashboard, mobile contract and immutable acceptance evidence.

## External providers

The repository includes provider-neutral delivery commands and a mock adapter for executable acceptance. Production promotion for external email, SMS, webinar or survey providers requires configured credentials, reachable callbacks and provider-specific acceptance evidence. Secrets are never stored in campaign records.

## Completion gate

`pnpm verify:crm-07-complete` validates the static contract and runs the PostgreSQL live acceptance journey. The gate fails closed unless all eight capabilities have passed evidence for the tested commit.
