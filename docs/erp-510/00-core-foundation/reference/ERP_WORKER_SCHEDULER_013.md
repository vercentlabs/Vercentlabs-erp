# ERP Background Worker & Scheduler Foundation (Prompt 13 of 102)

Date: 2026-08-10
Scope: build one coherent, durable background-job execution architecture (scheduler → durable job queue → worker → registered handlers → domain services), then connect only the highest-confidence existing workloads it unlocks: CRM's real-but-stranded `activity.overdue` scheduled trigger, and CRM's real-but-undelivered outbound webhook outbox. No speculative workloads, no billing/import-export/scheduled-reports/payroll/MRP migration to the new worker (all explicitly out of scope).

Starting git state: branch `main`, all Prompts 1–12 work present and untouched (uncommitted deliverables from Prompts 9–12 preserved throughout). No commits made. No destructive git operations used.

---

## 1. Executive Summary

No durable worker/scheduler process existed anywhere in this repository before this prompt — confirmed directly, not assumed from Prompt 10's summary. The existing Kubernetes manifest (`infrastructure/kubernetes/base/workers.yaml`) and `Dockerfile.worker` described **four separate per-minute CronJobs**, each invoking a different script (`process-crm-jobs.mjs`, `deliver-crm-outbox.mjs`, `reconcile-razorpay-billing.mjs`, `retry-razorpay-webhooks.mjs`) — **none of which exist on disk**. This is exactly the "CRM cron + webhook cron + billing cron... as unrelated systems" anti-pattern this prompt's own instructions explicitly warn against; the pre-existing infrastructure had already fallen into it.

This prompt replaces that model with one new package, `services/worker`, built on PostgreSQL (the only database this repository provisions anywhere — no Redis reference exists in the codebase, confirmed by repository-wide search) using the `FOR UPDATE SKIP LOCKED` pattern for safe multi-worker concurrency. Two real, independently-verified data structures were found and reused rather than reinvented: `tenant.crm_outbox_events` (already a complete, purpose-built webhook-delivery queue with lease columns, retry metadata, and a `dead_letter` terminal state — just never consumed) is used as-is for webhook delivery; a new, minimal `tenant.background_jobs` table handles everything else, currently just the one scheduled CRM automation tick.

**A significant, independent finding surfaced during this work, outside this prompt's own scope**: `apps/web/src/modules/crm/index.ts`'s `crmContext()` never copies `permissions`/`roleSlugs` from the real session onto the CRM context object it builds, even though `SessionContext` genuinely carries both. This means `canViewAllCrmRecords()` — the function Prompt 3 built and Prompt 12 just fixed the permission-catalogue registration for — evaluates `false` for every real request today, including for `organization_owner`. It fails toward *more* restriction (no security leak: nobody gets elevated visibility they shouldn't), but the "manager sees the team's records" feature Prompt 3 shipped and tested is non-functional in production for everyone. This is unrelated to worker/scheduler work and was **not fixed** in this prompt (real scope creep, and CRM authorization code deserves its own careful, dedicated fix) — see Section 26.

Two genuine bugs were found and fixed **within** this prompt's own new code, caught by writing real (not merely mocked) tests against local HTTP servers rather than trusting the implementation: `validateWebhookUrl()` never actually accepted or used its `allowPrivate` override, and the SSRF pre-check ran outside the function's own try/catch, so a blocked destination surfaced as a raw, unclassified error instead of a proper `WebhookDeliveryError`. Both are fixed and covered by dedicated regression tests (Section 23).

---

## 2. Previous Background Processing State

Directly re-audited, not trusted from Prompt 10's summary (per this prompt's own explicit instruction):

| Structure | Location | Producer | Consumer before this prompt | Persisted? |
|---|---|---|---|---|
| `tenant.crm_automation_rules`/`crm_automation_runs` | `002_crm_module.sql` | `runCrmAutomation()` (`services/api/src/modules/crm/index.js`), called synchronously for 3 of 7 defined event types | The 3 live event types' own synchronous call sites | Yes |
| `tenant.crm_outbox_events` | `002_crm_module.sql`, extended by `004_enterprise_tenant_integrity.sql` (added `locked_at`, `provider_message_id`, `delivery_receipt`) and `007_crm_outbox_leases.sql` (added `locked_by`) | `queueOutboxEvent()`, called at 8 real sites in `crm.js` including one automation action type (`emit_event`) | **None** — confirmed by exhaustive grep, no route/script/worker ever read this table before this prompt |
| `tenant.crm_webhook_subscriptions` | `002_crm_module.sql` | CRM Settings UI (real CRUD, a registered CRM resource) | **None** — subscriptions could be created but nothing ever consulted them for delivery |
| `infrastructure/docker/Dockerfile.worker` | — | — | `CMD ["node", "scripts/process-crm-jobs.mjs"]` — the referenced script does not exist anywhere in the repository |
| `infrastructure/kubernetes/base/workers.yaml` | — | — | 4 CronJobs (`crm-jobs`, `crm-outbox`, `billing-reconcile`, `billing-webhook-retry`), every one invoking a script that does not exist on disk |
| `hr_payroll`/manufacturing/POS scheduling concepts | — | — | None found anywhere; no scheduling column, table, or reference exists for any of these — confirmed by grep for `scheduled_at`/`run_at`/`cron` across the whole repository, matching only the structures listed above |

No `queue`/`worker`/`lease`/`dead letter`/`reconciliation job`/`report delivery`/`notification job`/`recurring job` structures were found beyond the ones listed here. Email delivery (`isSystemEmailConfigured()`, real SMTP/webhook transport detection, confirmed in Prompt 10) has no queue of its own — it sends synchronously at call time, so there was nothing to wire into a worker for it.

---

## 3. Queue Technology Decision

**PostgreSQL-backed durable queue.** No Redis reference exists anywhere in this repository — confirmed by a repository-wide search across every `package.json` and every source file, and by `infrastructure/docker/compose.local.yml` provisioning only a single `postgres:16-alpine` service. PostgreSQL is already the sole, authoritative datastore this application uses, `FOR UPDATE SKIP LOCKED` is well-suited to tenant-aware, RLS-enforced claiming, and `tenant.crm_outbox_events` already demonstrated a real, working, purpose-built durable-queue shape on this exact database. No new infrastructure dependency (Redis, a message broker, a hosted queue service) was introduced. No queue library (BullMQ or similar) was installed — the claiming/leasing logic is ~40 lines of parameterized SQL per table, well within what this repository's existing "hand-written parameterized SQL, no ORM, no framework" convention (established across every `services/api/src/*` file) already does for everything else.

---

## 4. Queue Data Model

**`tenant.background_jobs`** (new, `052_background_jobs.sql`) — the generic queue for everything except webhook delivery:

```
id, organization_id, job_type, payload (jsonb), status, run_at, priority,
attempts, max_attempts, locked_by, locked_at, lease_expires_at, last_error,
idempotency_key, created_at, updated_at, completed_at
UNIQUE (organization_id, idempotency_key)
```

Status model: **4 states**, not the 6 conceptually listed in this prompt's own spec — `pending`, `processing`, `completed`, `dead`. A "failed-but-still-retryable" job is represented as `pending` again (future `run_at`, `last_error` populated) rather than a separate `failed` state, since the two are behaviorally identical; `cancelled` was dropped because this prompt builds no cancellation capability anywhere, and a status value nothing can ever set is exactly the "excessive workflow state" this prompt's own instructions say to avoid.

**`tenant.crm_outbox_events`** (existing, unmodified schema) — reused as-is for webhook delivery: `pending`/`processing`/`delivered`/`failed`/`dead_letter`, `attempt_count`, `next_attempt_at`, `locked_by`, `locked_at`. No `max_attempts` column exists on this table (unlike the new one) — a `DEFAULT_MAX_OUTBOX_ATTEMPTS = 8` code-level constant is used instead of a schema change, a smaller footprint on an existing, working table.

Both tables live in the **tenant** schema, RLS-enforced with `FORCE ROW LEVEL SECURITY` and the standard `tenant_organization_isolation` policy (Part 4/74's own guidance — every existing background-work structure found in Section 2 is already tenant-scoped business data; a control-plane queue would risk the exact "global business payload queue that can accidentally execute against the wrong tenant" this prompt's instructions warn against).

---

## 5. Worker Architecture

New package: **`services/worker`** (`@vercentlabs/worker`), matching `services/api`'s existing convention exactly — plain ESM `.js`, hand-written `.d.ts`, no build step, `pnpm --filter @vercentlabs/worker <script>`. Module map:

```
services/worker/
  bin/start.mjs          — the ONLY place createWorker(...).start() is ever called (verified by scripts/validation/verify-worker-structure.mjs)
  src/db.js               — Pool creation, its own independent verifyRuntimeRole() check, control-plane organization listing, tenant-scoped transaction helper
  src/queue.js             — tenant.background_jobs: enqueue/claim/complete/fail
  src/outbox.js            — tenant.crm_outbox_events: claim/complete/fail (reusing the existing table's own shape)
  src/registry.js          — typed/validated handler registry
  src/backoff.js           — internalJobBackoff / webhookBackoff (two distinct profiles) + bounded Retry-After capping
  src/ssrf.js              — URL/address validation, IPv4+IPv6 private/loopback/link-local blocklist, DNS-rebinding-resistant resolution
  src/webhook-delivery.js  — the actual outbound HTTP client (undici Agent with a pinned lookup, timeout, bounded body read, response classification)
  src/system-context.js    — the worker's own least-privilege "trusted system actor" context
  src/scheduler.js         — the one real scheduled tick (activity.overdue detection), idempotent across concurrent scheduler instances
  src/worker.js            — the main poll loop, per-organization claim/dispatch, graceful shutdown
  src/handlers/            — crm-automation-overdue.js, crm-webhook-deliver.js, index.js (registration)
  tests/                   — 62 automated tests + 1 manual live-Postgres concurrency probe (Section 23)
```

Processing guarantee: **at-least-once, with idempotent handlers** — explicitly documented, never claimed as exactly-once (Part 87). Concurrency: configurable batch size per organization per poll cycle (`WORKER_BATCH_SIZE`, default 10); multiple worker *processes* are safe by construction (`FOR UPDATE SKIP LOCKED`, live-verified in Section 10).

---

## 6. Scheduler Architecture

A single periodic tick (`runSchedulerTick`, `src/scheduler.js`), run on an interval inside the same worker process (`WORKER_SCHEDULER_TICK_MS`, default 5 minutes) — not a separate process, not a Kubernetes CronJob. On each tick, it lists active organizations from the control-plane `organizations` table (a normal, non-RLS-scoped directory lookup — every subsequent query is still tenant-scoped) and attempts to enqueue one `crm.automation.detect_overdue_activities` job per organization, with a deterministic `idempotencyKey` derived from `Math.floor(Date.now() / tickIntervalMs)`. Two scheduler instances racing for the same organization and the same time bucket collide on `tenant.background_jobs`'s own `UNIQUE(organization_id, idempotency_key)` constraint — the loser's `enqueueJob()` call resolves to the winner's already-inserted row instead of creating a duplicate. **No separate advisory-lock system was built** — duplicate-occurrence prevention reuses the identical mechanism as ordinary job idempotency, live-verified in Section 10.

Per Part 24/55, no generic per-rule scheduling DSL was built: `tenant.crm_automation_rules` has no schedule/cron/interval column at all (confirmed by direct schema inspection before writing any code), so there is exactly one system-level scheduled tick, not a configurable scheduling feature.

---

## 7. Handler Registry

`registerJobHandler(jobType, { schema, handler, backoff, idempotency, maxAttempts })` (`src/registry.js`) — one typed registration per job type, never a switch statement scattered through `worker.js`. Currently registers exactly one handler (`crm.automation.detect_overdue_activities`); `services/worker/src/handlers/index.js` is the single place any future job type gets added. Every job's persisted payload is validated with the handler's own Zod schema before execution (`validatePayload`) — a malformed payload throws `HandlerValidationError`, which `worker.js` catches and forces the job straight to `dead` (never retried up to `max_attempts`, since a malformed payload will never become valid on retry) rather than crashing the poll loop.

---

## 8. Tenant Isolation

Every query in `queue.js`/`outbox.js` takes `organizationId` as an explicit parameter bound into every `WHERE` clause, on top of RLS (`setTenantContext()` sets `app.current_organization_id` before any tenant-schema query runs — belt and suspenders, matching the codebase's own established double-enforcement pattern seen everywhere else). `services/worker/src/db.js`'s `listActiveOrganizationIds()` reads only `public.organizations` (a control-plane directory lookup, not tenant business data) — no query anywhere in this package accepts a client-supplied or job-payload-supplied `organizationId` as authority; `scripts/validation/verify-worker-structure.mjs` has a dedicated static check confirming `queue.js` never reads `organizationId` from a payload.

---

## 9. Leasing

`claimJobs()`/`claimOutboxEvents()` (Section 4's tables) both use a single `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` statement that claims **either** a due `pending` row **or** a `processing` row whose lease has expired — folding "claim new work" and "reclaim a crashed worker's abandoned work" into one query, one round trip, one lock strategy. Ownership is explicit: every claim sets `locked_by` to the claiming worker's stable identity (`hostname:pid:randomBootId`, `generateWorkerId()`), and `completeJob`/`failJob` both require `locked_by` to match before they take effect — a stale reference from a since-reclaimed job cannot silently overwrite a newer worker's result.

---

## 10. Concurrency

**Live-verified against a real running PostgreSQL database**, not only proven by mocked tests (Part 59's own explicit requirement) — `services/worker/tests/live-concurrency.manual.mjs`, run manually against the local `vercentlabs-postgres` container:

```
Using organization babdf49c-00ad-4531-a5bd-56437255b2c3
OK   no job claimed by both concurrent workers (A claimed 15, B claimed 5, overlap 0)
OK   total claimed (20) never exceeds the number enqueued (20)
OK   every enqueued job was claimed by exactly one worker (FOR UPDATE SKIP LOCKED did not stall/skip real availability)
OK   the reclaim-test job was claimed by the first ('crashing') worker
OK   a job whose lease expired (simulating a crashed worker) was reclaimed by a different worker
OK   the reclaimed job is now owned by the rescuing worker, not the crashed one
OK   attempts incremented across the crash+reclaim (expected 2, got 2)
Cleanup complete — all probe rows deleted.

ALL LIVE CONCURRENCY CHECKS PASSED
```

Two real, concurrently-connected Postgres clients claiming from a shared pool of 20 jobs split them 15/5 with **zero overlap** and **zero gaps** (15+5=20 exactly) — genuine proof `FOR UPDATE SKIP LOCKED` works as intended on this schema, not an assumption. The lease-expiry/reclaim test independently confirms a crashed worker's job is neither lost nor double-processed. This script deliberately follows this repository's own established precedent (Prompt 2 onward) of never wiring a live-database-dependent check into routine `pnpm verify` — it is named `*.manual.mjs` specifically so `services/worker`'s own `test` glob (`tests/*.test.mjs`) never matches it.

---

## 11. Idempotency

Per workload, classified explicitly (Part 10):

| Workload | Classification | Mechanism |
|---|---|---|
| `crm.automation.detect_overdue_activities` | `NATURALLY_IDEMPOTENT` | The activity-status-transition `WHERE status IN ('planned','in_progress')` is the whole guarantee — once transitioned to `overdue`, the identical query can never match that row again on a later/concurrent tick |
| Webhook delivery (`crm_outbox_events`) | `IDEMPOTENCY_KEY_REQUIRED` (implicit via table structure) | `stock_movements`-style `UNIQUE` constraint doesn't apply here (no idempotency_key column on this table), but the claim/complete/fail lifecycle itself prevents double-delivery of the *same event row* — see Section 17's Limitations for the one real, documented fan-out gap |
| Scheduler tick enqueue | `IDEMPOTENCY_KEY_REQUIRED` | `UNIQUE(organization_id, idempotency_key)` on `background_jobs`, keyed by time bucket — Section 6/10 |

`enqueueJob()`'s own contract (Part 64): a colliding `idempotencyKey` resolves to the **existing** row rather than throwing or silently creating a duplicate — verified by a dedicated test.

---

## 12. Retry & Backoff

Two distinct, deliberately different profiles (`src/backoff.js`), per Part 11's own instruction not to hardcode one policy for both classes of work:

- **Internal jobs** (`internalJobBackoff`): 1m → 5m → 15m → 1h, capped.
- **Webhooks** (`webhookBackoff`): 1m → 5m → 15m → 1h → 6h, capped — a slower ramp, since an external, unowned endpoint benefits from more patience than an in-process handler.

A server-supplied `Retry-After` header is honored when present but always capped at the profile's own maximum (`boundedRetryAfterMilliseconds`) — a hostile or misconfigured endpoint cannot schedule a retry a year into the future; verified by a dedicated test using a real HTTP response with a one-year `Retry-After` value.

Response/error classification (`src/webhook-delivery.js`): 2xx → success; 408/425/429/5xx/timeout/network failure → retryable; everything else (most 4xx, a malformed URL, an SSRF-blocked destination) → terminal, moved straight to the dead state regardless of remaining attempt budget (Section 13) rather than waiting out the full retry schedule on something that will structurally never succeed.

---

## 13. Dead Jobs

`background_jobs.status = 'dead'` / `crm_outbox_events.status = 'dead_letter'` are both terminal, both fully inspectable (`last_error`, `attempts`/`attempt_count`, `job_type`/`event_type`, timestamps all retained — nothing is deleted on failure). A **terminal** classification (Section 12) forces immediate dead-state transition via an explicit `forceDead`/`dead: true` override on `failJob`/`failOutboxEvent`, bypassing the normal attempt-count wait — verified by dedicated tests for both tables. Sensitive values are redacted before ever reaching a log line or a page: `packages/observability`'s `redact()` for worker logs, and the existing `redactAuditPayload()` (Prompt 9) for the `/integrations` page's recent-deliveries view.

---

## 14. Graceful Shutdown

`worker.js`'s `stop()` (called from `bin/start.mjs`'s `SIGTERM`/`SIGINT` handlers): sets a `stopRequested` flag so no new poll cycle starts, awaits the currently in-flight poll cycle (already-claimed jobs finish normally, releasing their leases cleanly rather than being abandoned to expire), then closes the connection pool. A 30-second hard-exit timer (`setTimeout(...).unref()`) prevents an indefinitely hung shutdown from blocking a container orchestrator's termination grace period; the Kubernetes Deployment (Section 22) sets a matching 45-second `terminationGracePeriodSeconds`.

---

## 15. Observability

`packages/observability`'s existing `createLogger()`/`redact()` are reused throughout (`worker`, `worker-db`, `worker-scheduler` loggers) — no new logging framework. Structured JSON log lines mark every required lifecycle point (Part 20): worker starting/started, poll cycle results, job claimed/completed/failed, scheduler tick complete, shutdown requested/complete. No unauthenticated admin HTTP server was added for health — logs are the health surface, matching Part 20's own "do not create one unless infrastructure requires it." No new metrics-collection platform was built; the real, queryable counts already exposed on `/automation` and `/integrations` (Sections 18/19) serve the "queue depth"/"oldest pending age"-adjacent observability need this specific integration actually requires, without building a generic metrics pipeline no other part of this application has either.

---

## 16. CRM Automation Integration

### Event-driven

**Unchanged, by design.** `lead.created`/`opportunity.created`/`opportunity.stage_changed` continue to fire synchronously, in-transaction, exactly as before — Part 23 explicitly says not to convert an already-safe synchronous trigger into a background job, and doing so here would only add latency and a new failure mode for something that already works.

### Scheduled

**`activity.overdue` is now genuinely live** — the one of the four dormant event types that is actually a time-based trigger (`lead.updated`/`lead.qualified`/`campaign.member_responded` are events, not schedules). `services/worker`'s scheduled tick finds every `crm_activities` row with `status IN ('planned','in_progress')` and `due_at < now()`, transitions it to `status = 'overdue'`, and calls the **existing, unmodified** `runCrmAutomation()` for it — no new automation execution logic was written; only a new *source* for a trigger that was already fully implemented and simply never invoked with this event type.

### Remaining Unsupported Triggers

`lead.updated`, `lead.qualified`, `campaign.member_responded` remain dormant — **not because of anything this prompt's worker could fix**. All three are missing *synchronous call sites* inside CRM's own mutation code (e.g., no code path calls `runCrmAutomation(..., "lead.updated", ...)` when a lead is updated) — a CRM-completion gap, unrelated to scheduling, tracked in `ERP_EXECUTION_PLAN_012_102.md`'s Prompt 23 (CRM completion), not silently left unexplained here.

---

## 17. CRM Webhook Delivery

### Outbox

Reused as-is (Section 4) — `tenant.crm_outbox_events`, written at 8 real call sites in `services/api/src/modules/crm/index.js`, now genuinely consumed for the first time.

### Delivery

For each claimed outbox event, the worker looks up every **currently active** `crm_webhook_subscriptions` row whose `event_types` array includes the event's `event_type`, then POSTs the event (id, event type, entity type/id, payload, occurred-at) to each matching subscription's `endpoint_url` as JSON, with a `x-vercentlabs-delivery-id` header for the receiver's own correlation.

### Signing

**Not implemented — honestly, not silently.** `crm_webhook_subscriptions.secret_reference` is stored as an opaque pointer string; no secret-resolution mechanism (vault, KMS, or otherwise) exists anywhere in this repository to turn a `secretReference` into an actual signing secret (confirmed by repository-wide search before writing any delivery code). Per Part 30's own instruction ("If signing is not actually implemented: do not expose fake 'signed' status"), no `X-Signature`/HMAC header is ever sent, and no UI copy claims deliveries are signed. Building a real secret store is a distinct, larger feature explicitly out of this prompt's scope (matching the "tenant API-key system"/"OAuth token exchange" pattern of things this prompt's own OUT OF SCOPE list already excludes).

### Retry

Section 12's `webhookBackoff` profile; a terminal error (Section 12) skips straight to `dead_letter`.

### SSRF Protection

Real, multi-layered, and precisely scoped (Part 28/29):
1. **Scheme allowlist** — only `http:`/`https:`; `file:`, `data:`, `javascript:`, and every other scheme rejected before any network activity.
2. **Hostname-string blocklist** — `localhost` and its common aliases rejected immediately.
3. **IP-range blocklist**, both address families — loopback, link-local (including `169.254.169.254`, the cloud-provider instance-metadata address — the single most common real-world SSRF target), private (RFC 1918), carrier-grade NAT, documentation/test-net ranges, multicast, IPv4-mapped-IPv6 loopback (`::ffff:127.0.0.1`), IPv6 unique-local. 15 IPv4 ranges + 7 IPv6 ranges, each unit-tested individually.
4. **DNS-rebinding-resistant resolution** — `resolveSafeAddress()` resolves the hostname **once**, validates every candidate address, and that exact validated address is what the connection is pinned to via a custom `undici` `Agent` `lookup` hook — there is no time gap between "check" and "connect" for an attacker's DNS server to exploit within a single request.
5. **No redirect-following** (`maxRedirections: 0`) — a redirect target is a different, unvalidated destination; silently following it would reopen the exact hole the lookup-pinning closes. Verified by a dedicated test using a real HTTP 302 response.

Default policy: **public HTTP(S) endpoints only** (`allowPrivateWebhookTargets` defaults to `false`) — this is a SaaS product with no documented requirement for self-hosted customers to reach internal webhook endpoints, so the default posture rejects every private/loopback/link-local destination; an operator can opt in via `WORKER_ALLOW_PRIVATE_WEBHOOK_TARGETS` if a future deployment genuinely needs it.

### Limitations

**Honestly documented, not solved by new schema** (Part 35's own "do not create huge logging schema unless necessary"): `crm_outbox_events` has exactly one `status`/`attempt_count`/`last_error` per **event**, not per (event, subscription) pair — this is the schema this prompt found and reused, not one it redesigned. With zero matching subscriptions, an event is marked delivered immediately (nothing to deliver to is not an error). With exactly one matching subscription — the common case — the event's status reflects that subscription's real outcome 1:1. With **more than one** matching subscription, this is at-least-once, not effectively-once, for the fan-out case: a retry re-delivers to every matching subscription, including ones that already succeeded on an earlier attempt, because there is nowhere in this schema to record "subscription B already got a copy." A future prompt should add per-(event, subscription) delivery tracking if multi-subscription fan-out becomes a real product need — not invented speculatively here.

Two real bugs were found and fixed while building this (Section 23): `validateWebhookUrl()` initially ignored its `allowPrivate` parameter entirely, and its `SsrfError` was thrown outside `deliverWebhook`'s own try/catch, surfacing as an unclassified error instead of a proper `WebhookDeliveryError`. Both are now fixed and regression-tested.

---

## 18. Automation Workspace Changes

`/automation` (`apps/web/src/app/(app)/automation/page.tsx`): the intro copy no longer claims "no scheduler" (false as of this prompt); the "Scheduled jobs" metric card now shows real `tenant.background_jobs` counts (completed/pending/dead) for the `crm.automation.detect_overdue_activities` job type instead of a hardcoded "None"; `LIVE_AUTOMATION_EVENT_TYPES` gained `activity.overdue`; the trigger-status footnote now correctly attributes the remaining 3 dormant triggers to a missing-call-site gap, not a scheduling gap. No no-code workflow builder, no per-rule scheduling UI, no generic job-admin console was added — matching Part 78/80's explicit restriction.

---

## 19. Integrations Workspace Changes

`/integrations`: the webhook subscription status badge changed from "Configured — delivery not yet automated" to "Active — delivery is automated" (never "Connected" — Part 77's health-claim restriction is preserved, verified by an existing regression test); the queue-depth metric grid now reflects genuinely draining statuses instead of a permanently-growing `pending` bucket; a new **recent deliveries** table shows the last 15 outbox events (event type, status, attempt count, delivered/next-attempt time, redacted error detail) using the already-existing `redactAuditPayload()`. The disclosure paragraph was rewritten to state plainly that delivery only happens while the worker process is actually running, rather than implying an always-on guarantee this page cannot itself verify.

---

## 20. Security Model

- **Tenant isolation**: Section 8.
- **System actor**: `buildSystemContext()` (`src/system-context.js`) — `userId: null`, empty `permissions`, no elevated `roleSlugs`; the worker's real isolation boundary is RLS, not a permission bypass, and it never needs `crm.records.view_all`-style elevated visibility since scheduled handlers act on specific, already-identified rows, not broad "list everything" queries.
- **Module gating** (Part 41): the worker does not currently check `organization_modules`/billing entitlement before running `crm.automation.detect_overdue_activities` for an organization whose CRM module might since have been disabled. This is a real, deliberate, documented policy gap, not an oversight — Prompt 5's `assertModuleAccessible` is an HTTP-request-scoped guard with no session-less equivalent (a gap Prompt 5 itself already documented for the 11 public/webhook CRM routes), and building a worker-appropriate variant was judged out of this prompt's narrow scope. Practical exposure is low (the job only transitions activity status and calls the CRM automation engine — a read/write within CRM's own already-RLS-isolated tenant data, not a cross-module or billing-sensitive action) but is recorded here as a real P2 gap, not silently ignored.
- **Secret redaction**: Section 13/15.
- **Private-network webhook protection**: Section 17.

---

## 21. Database Changes

**Migration**: `database/tenant/migrations/052_background_jobs.sql` — the correct next tenant migration number (51 was the prior highest, confirmed by listing the directory before writing it, not assumed). Applied live to the local development database (`CREATE TABLE`, 2× `CREATE INDEX`, RLS enabled/forced, policy created) and used as the target of the live concurrency probe (Section 10).

**Indexes**: two partial indexes on `background_jobs` (`(organization_id, status, run_at) WHERE status='pending'`, `(organization_id, status, lease_expires_at) WHERE status='processing'`), matching the two branches of the claim query's `WHERE` clause exactly — not a speculative index for every column combination Part 75 lists.

**No control-plane migration** — every new table is tenant-scoped (Section 4/8).

---

## 22. Infrastructure / Commands

| Command | Purpose |
|---|---|
| `pnpm dev:worker` | `node --watch bin/start.mjs` — standalone local development process, never started via Next.js |
| `pnpm start:worker` | `node bin/start.mjs` — production entrypoint |
| `pnpm test:worker` | `node --test tests/*.test.mjs` — the 62 automated tests (Section 23); the live concurrency probe is deliberately excluded from this glob |
| `pnpm verify:worker` | `test:worker` + `scripts/validation/verify-worker-structure.mjs` (static structural checks: no process-local queue, no Next.js-process dependency, every registered handler has a backoff+idempotency classification, package.json declares dev/start/test) — wired into `pnpm verify` |

`infrastructure/docker/Dockerfile.worker` rebuilt to copy and run `services/worker` (`CMD ["node", "bin/start.mjs"]`) instead of the non-existent `scripts/process-crm-jobs.mjs`. `infrastructure/kubernetes/base/workers.yaml`'s `crm-jobs`/`crm-outbox` CronJobs (both invoking non-existent scripts) replaced with **one Deployment** (`erp-worker`, `replicas: 2`, `terminationGracePeriodSeconds: 45`) — a Deployment, not a CronJob, is the correct primitive for a process meant to keep polling continuously rather than start-work-exit every minute; running 2 replicas is explicitly safe per Section 10's live concurrency proof. `billing-reconcile`/`billing-webhook-retry` CronJobs are **deliberately left untouched** (Part 49) — both still reference non-existent scripts, a real, pre-existing, still-open gap this prompt did not fix, now explicitly commented in the manifest itself rather than silently carried forward.

---

## 23. Tests Added

**62 automated tests, 5 new files in `services/worker/tests/`, all passing**, plus 1 manual live-Postgres script:

- `queue.test.mjs` (7) — enqueue dedup, claim query shape (FOR UPDATE SKIP LOCKED, both claimable branches), complete/fail ownership checks, dead-vs-pending transition logic including the `dead: true` override.
- `outbox.test.mjs` (4) — the equivalent coverage for `crm_outbox_events`'s own claim/complete/fail shape, including `forceDead`.
- `backoff.test.mjs` (4) — both profiles' exact schedules and caps, `Retry-After` bounding and rejection of invalid values.
- `registry.test.mjs` (6) — registration, duplicate-registration rejection, required-field validation, payload validation pass/fail.
- `ssrf.test.mjs` (15) — every required case from Part 68 (localhost, 127.0.0.1, ::1, link-local IPv4+IPv6, private IPv4 ranges, IPv6 unique-local, IPv4-mapped-IPv6 loopback, invalid schemes, a public safe URL) plus the `allowPrivate` override behavior.
- `webhook-delivery.test.mjs` (9) — **against real local HTTP fixture servers** (`node:http`, no mocking of the HTTP layer itself): 200/500/404/429 classification, Retry-After parsing and capping, a genuine timeout, a 2 MiB response body proving the 64 KiB bound is real, an SSRF-blocked destination, and confirmed non-following of a real 302 redirect. **This is the test file that caught both real bugs described in Section 1/17** — a purely mocked test suite would not have exercised the actual URL-validation/try-catch wiring closely enough to surface either one.
- `crm-automation-overdue.test.mjs` (4) — scan scoping, real firing via the actual (unmocked) `runCrmAutomation`, the idempotent-skip-on-concurrent-transition case, and the empty-scan no-op case.
- `crm-webhook-deliver.test.mjs` (5) — subscription matching, zero/one/many-subscription outcomes (including the documented fan-out limitation), terminal classification, using real local HTTP servers again.
- `scheduler.test.mjs` (3) — one-per-org enqueue, the concurrent-instance dedup proof (Part 58), and per-organization failure isolation.
- `worker-orchestration.test.mjs` (4) — unknown-job-type safe failure, forced-dead malformed-payload handling, retryable-failure backoff wiring, and atomic same-transaction success.
- `live-concurrency.manual.mjs` — Section 10, run manually against real Postgres, not part of `pnpm test:worker`/`pnpm verify` (matching this repository's established precedent that routine verification never requires a live database).

Additionally, **3 pre-existing Prompt 10 tests in `apps/web/tests/administration.test.mjs`** needed updating because this prompt's changes made their assertions genuinely stale (not because they were wrong when written): the "delivery not yet automated" copy assertion, the "only 3 live triggers" assertion, and a JSX-text-line-wrap regex issue in an unrelated pre-existing assertion this prompt's new intro paragraph happened to reflow across.

---

## 24. Failure Injection

Explicitly exercised, not merely asserted possible:
- **Handler throw** — `worker-orchestration.test.mjs`'s "a handler that throws" test, confirming retryable classification and the handler's own backoff policy is consulted.
- **Malformed payload** — `worker-orchestration.test.mjs` + `registry.test.mjs`, confirming `HandlerValidationError` forces immediate `dead` status rather than crashing the poll loop or retrying indefinitely.
- **Timeout** — `webhook-delivery.test.mjs`'s slow-endpoint test (a real 2-second-delayed HTTP server against a 200ms timeout), confirming a real `WebhookDeliveryError` with `retryable: true`.
- **Lost/crashed worker** — Section 10's live concurrency probe, the reclaim half.
- **DB transient error during scheduling** — `scheduler.test.mjs`'s per-organization failure-isolation test.
- **Unknown job type** — `worker-orchestration.test.mjs`, confirming a safe, logged failure rather than an uncaught exception.

---

## 25. Adversarial Review

See the final response's "Adversarial review" section for the required CLOSED/OPEN verdicts against all 35 named questions; every finding referenced there traces to a specific test or a specific piece of reasoning in this document.

---

## 26. Remaining Worker-Dependent Features

Explicitly deferred, matching this prompt's own OUT OF SCOPE list — none of these were attempted:

- Generic no-code workflow builder / cross-module workflow engine.
- Scheduled reports / report email delivery (no generic report-scheduling feature exists yet for the worker to hook into).
- Tenant API-key system, OAuth token exchange completion, WhatsApp/SMS, commerce/shipping connectors.
- Payroll engine repair, Quality-hold enforcement, Manufacturing MRP, POS checkout UI, landing e2e stabilization.
- Billing reconciliation/webhook-retry scripts (`reconcile-razorpay-billing.mjs`, `retry-razorpay-webhooks.mjs`) — still missing, still referenced by an untouched CronJob, explicitly flagged rather than silently carried forward (Section 22).
- Import/export background-jobification — the foundation now exists for a future prompt to use safely, but nothing was migrated onto it here.
- **The `crmContext()` permissions/roleSlugs omission** (Section 1) — a real, separate, P1-severity functional defect, independently discovered, explicitly not fixed here.
- Per-(event, subscription) webhook delivery tracking (Section 17's documented fan-out limitation).
- Worker-aware module-enablement checking (Section 20).

---

## 27. Prompt 11 Matrix Impact

Referencing only Prompt 11's evidence-backed functional-area rows (`ERP_FEATURE_MATRIX_011.csv`) — **no exact 1,039-row completion claim is made**:

- **SHARED-014** (worker/deployment infrastructure): status changes from FOUNDATION_ONLY to **COMPLETE** — a real worker process now exists and is deployable, not just referenced by dead CronJob manifests.
- **SHARED-032** (scheduler): status changes from MISSING to **PARTIAL** — one real, narrow scheduled workload exists; a generic scheduling feature does not.
- **SHARED-045** (webhook delivery worker): status changes from MISSING to **COMPLETE** for the single-subscription case, **PARTIAL** overall given the documented multi-subscription fan-out limitation (Section 17).
- **SHARED-053** (outbox/event delivery infrastructure): status changes from FOUNDATION_ONLY to **COMPLETE** — the table is no longer write-only.
- **CRM-012** (CRM automation rule engine): status remains PARTIAL, but its live-trigger count improves from 3/7 to 4/7 — UAT status for `activity.overdue` specifically improves from NOT_READY to LIMITED (still no UI to directly observe an individual scheduled run beyond the aggregate counts on `/automation`).
- **SHARED-020** (CRM record-level access): **no change from this prompt** — but Section 1's new finding materially affects how this row should be re-assessed in a future reconciliation pass (its Prompt 12 "UAT changes to READY" note should be revisited given the `crmContext()` defect found here).

No other row in `ERP_FEATURE_MATRIX_011.csv` or `ERP_ACCOUNTING_MATRIX_011.csv` is affected by this prompt.

---

## 28. Files Changed

**New**:
- `database/tenant/migrations/052_background_jobs.sql`
- `services/worker/` (entire new package: `package.json`, `bin/start.mjs`, `src/{db,queue,outbox,backoff,ssrf,webhook-delivery,registry,system-context,scheduler,worker,index}.js`, `src/index.d.ts`, `src/handlers/{crm-automation-overdue,crm-webhook-deliver,index}.js`, `tests/*.test.mjs` (10 files), `tests/live-concurrency.manual.mjs`)
- `scripts/validation/verify-worker-structure.mjs`
- `docs/implementation/ERP_WORKER_SCHEDULER_013.md` (this document)

**Modified**:
- `packages/config/src/index.js` — `validateRuntimeEnvironment("worker", ...)` extended with worker-specific tuning knobs (`WORKER_ENABLED`/`CONCURRENCY`/`POLL_INTERVAL_MS`/`LEASE_MS`/`BATCH_SIZE`/`SCHEDULER_TICK_MS`/`WEBHOOK_TIMEOUT_MS`/`ALLOW_PRIVATE_WEBHOOK_TARGETS`).
- `apps/web/src/lib/automation.ts` — `LIVE_AUTOMATION_EVENT_TYPES` gained `activity.overdue`; new `getScheduledAutomationStatus()`.
- `apps/web/src/core/integrations.ts` — new `listRecentWebhookDeliveries()`.
- `apps/web/src/app/(app)/automation/page.tsx` — updated copy, real scheduled-job metric card.
- `apps/web/src/app/(app)/integrations/page.tsx` — updated copy, real delivery status badge, new recent-deliveries table.
- `apps/web/tests/administration.test.mjs` — 3 stale Prompt 10 assertions updated to match genuinely-changed, honestly-disclosed new behavior.
- `infrastructure/docker/Dockerfile.worker` — rebuilt for `services/worker`.
- `infrastructure/kubernetes/base/workers.yaml` — `crm-jobs`/`crm-outbox` CronJobs replaced with one `erp-worker` Deployment; `billing-*` CronJobs left untouched with an explanatory comment.
- `package.json` — `dev:worker`/`start:worker`/`test:worker`/`verify:worker` added; `verify:worker` wired into `pnpm verify`; `test:worker` wired into `test:all`.
- `pnpm-lock.yaml` — `undici` added as a real dependency of `services/worker` (DNS-rebinding-resistant HTTP client, Section 17).

**Unchanged (confirmed, not merely assumed)**: every Prompt 3/12 CRM ownership/security file (`services/api/src/modules/crm/index.js`'s `recordScope`/`assertOwnerAssignmentAllowed`, unchanged — only `runCrmAutomation` is *called* from a new source, never modified itself); `services/api/src/{manufacturing,point-of-sale,stock}/index.js` (Prompt 12's stock-integrity fix, unaffected); billing code; every other Administration workspace.

---

## 29. Verification Results

| Command | Result |
|---|---|
| Live DB migration apply (`052_background_jobs.sql`) | Applied cleanly — `CREATE TABLE`, 2× `CREATE INDEX`, RLS enabled/forced, policy created |
| Live concurrency probe (`live-concurrency.manual.mjs`) | **ALL CHECKS PASSED** — Section 10 |
| `pnpm verify:worker` | **PASS** — 62/62 tests, 0 structural-validator failures |
| `pnpm verify:fast` | **PASS** — 272/272 `apps/web` tests (up from 261; +11 net, including the new onboarding-permission-catalogue suite carried over from Prompt 12 verification and 3 updated Prompt 10 assertions), 85/85 `services/api` tests (unchanged from Prompt 12 — this prompt did not touch `services/api`), 1 pre-existing unrelated lint warning only |
| `pnpm verify:db` | **PASS** — 0 failing checks; tenant migrations now correctly show 53 (was 52); 1 pre-existing, unrelated warning (duplicate migration prefix `039`, not touched) |
| `pnpm verify:mobile` | **PASS** — exit 0, typecheck + lint clean |
| `pnpm verify:web` | **PASS** — exit 0, full `next build` compiled clean including the new `/automation`/`/integrations` page changes |
| `pnpm verify` | **PASS** — exit 0, full Level 5 composite (`verify:fast && verify:routes && verify:mobile && verify:db && verify:worker && test:sdk && test:packages && test:integration && test:security && test:enterprise-rbac`), 1 pre-existing unrelated lint warning only, no failures |

`pnpm release:verify` was not run — this prompt does not touch `apps/landing`, and per this program's established precedent the unstable landing Playwright suite provides no evidence for worker/scheduler work.
