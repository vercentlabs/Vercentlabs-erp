# Billing Module

The Billing module supports non-seat-based SaaS subscriptions for Vercentlabs ERP.

## Plans

| Plan       |            Monthly |     Yearly | Companies | Branches | Storage | API / month | Automations or outbound actions / month |
| ---------- | -----------------: | ---------: | --------: | -------: | ------: | ----------: | --------------------------------------: |
| Launch     |             ₹3,999 |    ₹39,990 |         1 |        2 |   25 GB |     100,000 |                                   5,000 |
| Growth     |             ₹9,999 |    ₹99,990 |         3 |       10 |  100 GB |     500,000 |                                  25,000 |
| Scale      |            ₹24,999 |  ₹2,49,990 |        10 |       50 |  500 GB |   2,000,000 |                                 100,000 |
| Enterprise | From ₹60,000/month | Contracted |    Custom |   Custom |  Custom |      Custom |                                  Custom |

All plans include unlimited users. Applicable taxes, high-volume communication, AI usage, migration, custom integration, dedicated infrastructure and expanded support are separate cost centres.

## Customer workflow

1. A new organisation receives a 14-day trial.
2. An authorised owner or finance manager selects a plan and billing period.
3. The server creates a Razorpay subscription using the server-owned provider plan ID.
4. Standard Checkout authorises recurring payment.
5. The server verifies the checkout signature.
6. Webhooks update subscription, payment and invoice state.
7. Failed payment enters a seven-day grace period before enforced read-only access.
8. Cancellation is scheduled for the end of the paid cycle.

## Operator workflow

- `pnpm billing:sync-plans` creates missing Razorpay plan records after economics validation.
- `pnpm billing:reconcile` refreshes provider subscription state.
- `pnpm db:verify:billing` verifies schema, plan catalogue and permission contracts.
- `pnpm verify:billing` runs source, service and SDK checks.

Use test-mode credentials until the complete checkout, webhook, retry, cancellation and recovery journey passes on a public staging URL.

## Production gate

Local and staging Test Mode checkout can be validated before launch. Production checkout remains disabled until `BILLING_CHECKOUT_ENABLED=true` is configured, a public HTTPS webhook has passed retries and ordering tests, and the company has established GST/tax-invoice, refund, reconciliation and customer-support procedures.

Self-service replacement of an active Razorpay subscription is intentionally blocked. This avoids overlapping mandates and double collection until a tested proration and plan-change workflow is implemented.
