# Billing and Entitlements Architecture

## Boundaries

- Control-plane PostgreSQL owns plans, prices, customers, subscriptions, payment metadata, invoices, webhooks, usage and overrides.
- Razorpay owns payment credentials, mandates, recurring collection and provider invoice generation.
- `services/api` owns provider-neutral billing payloads, status mapping and margin calculations.
- `packages/shared-types`, `packages/shared-sdk` and `packages/permissions` expose reusable contracts.
- `apps/web` owns authenticated checkout orchestration, billing UI, webhook receipt and current Route Handlers.
- The landing app publishes the commercial catalogue but never contains payment secrets.

## Security invariants

1. API key secret and webhook secret exist only in ignored server environment files.
2. Checkout payment signatures are verified on the server.
3. Webhooks are verified against the unmodified raw body.
4. Webhook event identifiers are idempotent and provider event time prevents older subscription events from overwriting newer state.
5. The organisation in the session selects the checkout price and owns every recorded provider identifier.
6. Client-supplied amount, plan or entitlement values are never trusted.
7. Provider payment credentials are never stored by Vercentlabs ERP.

## Commercial safety

Public prices are versioned and immutable once used. Provider plan identifiers are attached to a specific version. The Razorpay plan sync refuses a plan whose estimated software gross margin falls below the configured floor after the conservative payment-cost reserve and estimated direct monthly cost.

Entitlements use company, branch, storage, API, automation and outbound-action limits. User accounts are unlimited. Limits can be overridden for a specific organisation with an expiry and reason.

## Enforcement

- `observe`: records and displays billing state without blocking writes. Use during development and initial rollout.
- `enforce`: expired, cancelled or out-of-grace subscriptions become read-only. Billing, authentication, export and support paths remain available.

Production must not enable `enforce` until Razorpay webhooks, reconciliation, customer support and a tested recovery process are operational.

## Go-live controls

- Production checkout is disabled unless `BILLING_CHECKOUT_ENABLED=true` is set deliberately.
- `RAZORPAY_MODE` must match the configured Test or Live key prefix, preventing an accidental live collection during testing.
- Webhook secret rotation can retain the previous secret temporarily so delayed retries remain verifiable.
- Failed webhook processing is recorded and can be retried; duplicate or concurrently delivered events are claimed idempotently.
- Self-service plan changes are blocked while an active recurring subscription exists until proration and provider cancellation are implemented safely. Billing support must perform a controlled change.
- Razorpay collection records do not replace Vercentlabs' responsibility to issue legally appropriate tax documents. Live collection should begin only after GST, invoice numbering, refund and accounting procedures are reviewed.
