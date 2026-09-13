# Performance tests

Reserved for load and latency tests against real business-module endpoints
once they exist. For this foundation prompt, the only exercisable target is
`apps/api`'s health endpoint, checked here as a smoke test - not a load test -
and only runs against an already-running API instance (`pnpm --filter
@vercentlabs/api dev`, or the built app). It is not part of `pnpm verify` or
CI; run it manually with:

```
API_BASE_URL=http://localhost:3001/api/v1 pnpm exec vitest run --config tests/performance/vitest.config.ts
```
