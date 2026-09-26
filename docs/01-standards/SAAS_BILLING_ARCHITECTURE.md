# SaaS billing architecture

Vercentlabs charging its own customers for Vercentlabs ERP. This is Shared
Platform billing. It is **not** tenant Accounting: a customer's own sales
invoices live in Accounting/Sales/POS, and nothing here ever posts to a
tenant's ledger.

Code: `services/api/src/core/billing/` (import only `billing/index.js`).
Worker: `services/worker/src/billing-maintenance.js`.
Web: `apps/web/src/app/api/billing/*`, `apps/web/src/features/billing/`.
Verification: `pnpm verify:billing` (static rules + unit tests),
`pnpm test:billing:db` (real PostgreSQL, zero skips),
`pnpm test:e2e:billing` (browser, local Razorpay stand-in).

## 1. Commercial model

| Plan | Code | Terms | Purchase |
|---|---|---|---|
| Free | `free` | 1 included user, ₹0, no payment details | automatic for new organisations |
| Standard | `standard` | first user included; ₹1,000 (100000 paise) per additional user per month, INR | online checkout; Razorpay quantity = additional users |
| Custom | `enterprise` (historical code) | contracted users, modules, limits, dates | never online; provisioned internally |

Examples: 1 user ₹0 · 2 users ₹1,000 · 5 users ₹4,000 · 10 users ₹9,000.

Money is integer paise everywhere; the browser only previews, the server
computes every amount from the price version.

## 2. Price versions are immutable

Commercial terms (amount, currency, period, included users) belong to a row
of `billing_plan_prices`. A change creates a **new version**; the old one is
retired (`active = false`), never edited. A database trigger rejects edits to
terms, re-pointing a linked provider plan, or reactivating a retired version;
a unique index allows one active version per plan and period. Each version
gets its own Razorpay plan, created lazily and linked once (a racing duplicate
plan is harmless: it has no subscriptions). Historical subscriptions keep
their version and `price_snapshot` forever. Archived plans (`launch`,
`growth`, `scale`, `founder-preview`) and their prices are kept.

**Migration 061** moved Free and Standard from 3 to 1 included user:
- Free organisations moved to Free v2 (1 user). Nobody was removed; those
  using more than 1 user (active members + valid pending invitations) started
  the 14-day seat-overage grace.
- Standard subscriptions **with** a provider subscription keep v1 terms
  (3 included, their paid quantity, provider plan, period, history) and are
  marked `metadata.legacy_commercial_terms`. Their next charge does not
  change. Moving one to v2 terms is a deliberate provider plan change, not a
  migration.
- The local development database contained only test-fixture subscriptions
  (stand-in ids such as `sub_<uuid>`, fixture organisations); no real paid
  customer was present when this was written.

## 3. State model

`organization_subscriptions.status` is our state; `provider_status` is only
what Razorpay last reported. `state.js` owns the transition table and
`hasWriteAccess`.

| status | meaning | business writes |
|---|---|---|
| `active` | Free, Standard charging, or a Custom contract (until its end date) | yes |
| `authenticated` | Standard mandate authorised **and confirmed with the provider**; first charge pending | yes |
| `past_due` | provider `pending`: a renewal failed, provider retrying | during the 7-day grace only |
| `halted` | provider `halted`: retries exhausted | no |
| `internal` | founder preview / internal | yes |
| `cancelled`/`completed`/`expired` | provider terminal; applied by reverting to Free | (reverted) |

Orthogonal facts: a checkout in progress (`billing_checkout_sessions.status`),
a scheduled cancellation (`cancel_at_cycle_end` + `cancellation_state`), a
scheduled seat reduction (`pending_paid_seats`), operator attention
(`reconciliation_required_at`). Seat overage (usage above capacity) adds a
14-day grace, then blocks business writes. Reads always work; Billing routes
never use the business write gate, so an expired, halted or over-limit
organisation can always pay, add users or remove users.

Transition sources: `checkout_confirmation`, `provider_fetch`, `webhook`,
`reconciliation`, `administrator`, `cancellation`. Tenant UI never shows raw
enums; `billingStateKey` maps to curated labels.

## 4. Sagas: never call Razorpay inside a transaction

Every provider mutation is **prepare (commit) → provider call → finalize**,
with the intent durable before the network call:

- **Checkout** (`checkout.js`): `provider_creating` → provider subscription
  (notes carry organisation, checkout session and price ids; `expire_by`
  bounds unpaid ones) → `created` → browser Razorpay Checkout → signed
  callback verified against the **server-stored** subscription id →
  `verifying` → provider fetch; plan id, quantity and notes must match the
  intent → `authorised`, organisation moves to Standard. One live session per
  organisation (unique index): double clicks reuse or refuse, never create a
  second subscription. If the provider is unreachable after a valid
  signature the session stays `verifying` and the user sees "verifying"; a
  mismatch is flagged for support and never activated. A superseded session
  whose subscription gets paid anyway is cancelled at the provider.
- **Seats** (`seats.js`): a `billing_seat_changes` row in `provider_pending`
  (at most one per organisation) → PATCH quantity (`now` for increases,
  `cycle_end` for reductions) → local capacity rises only when the provider
  shows the new quantity; a scheduled reduction applies when a **new cycle**
  shows the scheduled quantity. Reductions below current usage are refused.
  Keeping the current number cancels the scheduled change
  (`cancel_scheduled_changes`).
- **Cancellation** (`subscriptions.js`): self-service is always at cycle end;
  service continues until the provider cancels, then the organisation reverts
  to Free. No refund is implied or issued. Immediate cancellation is a
  support-only function.

A provider **rejection** marks the intent failed (nothing changed). An
**unknown** outcome (timeout, network error, provider 5xx) leaves the intent
pending for the worker. Recovery only uses documented provider APIs: fetch,
list by plan id and time window (matching our session note), re-issuing
absolute operations (a quantity, `cancel_scheduled_changes`), which converge
instead of double-applying.

## 5. Webhooks: ingestion vs processing

`POST /api/billing/webhook` (public, no session) reads at most 256 KB, verifies
HMAC-SHA256 over the exact raw body (current or previous secret), validates
the envelope, stores a **minimised** payload (no contact data, card, UPI or
bank details, no signature) deduplicated by `X-Razorpay-Event-Id` (a
deterministic hash when absent) and returns 2xx.

The worker claims due events with `FOR UPDATE SKIP LOCKED`, a lease
(`processing_owner`, `processing_lease_expires_at`) and an attempt count,
processes oldest provider events first, and applies each inside one
transaction that re-checks lease ownership while holding the row lock.
Failures back off 1, 2, 4 … 60 minutes; after 8 attempts the event is
`dead_lettered` and stays inspectable. Expired leases are reclaimed.

Trust: an event affects only the organisation **our records** map its
provider object to (subscription, checkout session, payment, invoice). A note
naming an organisation is used only when it matches one of our own pending
checkout intents for the same plan; otherwise the event is ignored. Ordering:
`last_provider_event_at` holds provider event timestamps only (our fetches
never move it); older events are ignored, and a terminal event clears the
provider subscription id so nothing can resurrect it. Payment/refund/invoice
events that arrive before their subscription event retry for an hour.

## 6. Reconciliation and the worker

`reconcileSubscription` fetches the provider subscription, checks it belongs
to the organisation and its price version, and applies it through the same
state function webhooks use; mismatches are flagged, never applied. "Refresh
status" calls it (and finishes a pending verification). The worker's platform
billing loop (`BILLING_MAINTENANCE_*`) processes webhooks, checkout recovery,
seat-change and cancellation recovery, and reconciles each paid subscription
at least daily, plus flagged or period-ended ones. It uses plain platform
connections: no tenant RLS context, no tenant job queue. The old
`/api/billing/retry` cron endpoint is removed.

## 7. Entitlements

Subscription → plan entitlements (modules/limits snapshot) → organisation
module enablement (`organization_modules`) → user permission. The layers stay
separate: a plan that includes a module does not enable it, and enabling a
module the plan lacks does not grant it.

## 8. Documents and tax

`billing_invoices` holds the payment provider's invoices/receipts
(`document_kind = 'provider_invoice'`) and is labelled as such. Vercentlabs GST
tax invoices are not generated; `taxInvoiceReadiness` lists the legal facts
(supplier legal name, GSTIN, state code, address, SAC, rate, numbering series)
that must be configured first and never enables generation by itself. The
billing profile stores structured legal name, email, phone, optional GSTIN
(state code derived from it), address, city, state, postal code, country.

## 9. Security and operations

- Authenticated Billing routes use `workspaceRoute` with `billing.view`,
  `billing.manage`, `billing.checkout` or `billing.audit`; saga routes use
  `transaction: "none"` because the saga commits before calling Razorpay.
- The client never chooses the organisation, price, provider plan, amount or
  entitlements. Only the public key id reaches the browser.
- Live mode ignores `RAZORPAY_API_BASE`; misconfiguration refuses to start the
  worker and returns 503 from Billing in production.
- Custom contracts: `provisionCustomSubscription` via
  `scripts/billing/provision-custom-subscription.mjs` (operator only,
  audited). Tenant users cannot change entitlements.
- Observability: `billing.*` structured logs and counters with low-cardinality
  labels (`observability.js`); `billing.audit` holders see a health panel only
  when something needs attention.
- Optional Razorpay test-mode smoke: `scripts/qa/razorpay-smoke.mjs` (skips
  without `rzp_test_` keys; never in CI).
