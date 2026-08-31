# Non-Functional Budgets

Status: `BASELINE_FOR_ARCHITECTURE_FREEZE`

These are default engineering budgets; a capability may define stricter or explicitly justified looser budgets.

- Common interactive read API: target p95 <= 300 ms under declared normal-load test data.
- Common synchronous business command excluding external provider latency: target p95 <= 500 ms.
- Search/saved-view query: target p95 <= 500 ms for supported indexed scopes.
- UI interaction acknowledgement: immediate local feedback; long work transitions to an observable async job rather than blocking indefinitely.
- Large grids: server pagination/filtering and client virtualization where data volume requires it.
- Heavy reports/reconciliation/import/export: asynchronous when they exceed synchronous budgets, with progress, cancellation where safe, retry and downloadable evidence.
- Capability tests declare representative 10/100/500/5,000-user or 10k/100k/1m/10m-record envelopes where relevant instead of claiming one universal scale number.

Performance evidence includes database plans/index behavior, worker throughput/backlog, provider limits and multi-tenant noisy-neighbor tests for high-risk paths.
