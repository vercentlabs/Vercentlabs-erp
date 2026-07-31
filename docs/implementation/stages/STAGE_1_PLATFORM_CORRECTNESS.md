# Stage 1 — Platform correctness and live verification

Stage 1 establishes the safety and evidence foundation required before the four
business modules are expanded.

## Implemented in this stage

- Browser and native login share the same credential-pair and IP rate limits.
- Anonymous password failures remain telemetry and cannot create a global user
  lock. Existing administrative or security locks are still honoured.
- Successful browser and native login share one reset path.
- Direct Sales order and quotation URLs show an explicit access-denied state
  instead of rendering an empty page.
- A disposable Stage 1 fixture validates real PostgreSQL rate-limit concurrency
  and idempotency-key ownership.
- Chromium submits six failed native login attempts, proves the account remains
  usable, signs in through the browser and opens a protected Sales route.
- A second restricted user signs in and verifies that a direct Sales URL shows
  access denied without querying Sales data.
- CI runs the live platform test after migrations and restricted-role database
  verification, and also enforces web/mobile lint and type checks plus formatting.

## Live-test safety

The fixture uses deterministic IDs and reserved `.invalid` addresses. It deletes
only those records during setup and cleanup. Database URLs must target localhost
unless an isolated CI environment explicitly opts in with
`ALLOW_PLATFORM_E2E_NONLOCAL=true`.

## Evidence boundary

This stage does not change any of the 419 business-capability classifications.
It makes later evidence stronger by requiring actual database and browser
execution for release-critical workflows.
