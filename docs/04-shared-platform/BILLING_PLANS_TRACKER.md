# Billing plans and seats: implementation tracker

Status legend: **Verified** = real-PostgreSQL integration test and/or browser spec; **Partial**; **Not built**.

## Commercial model built

| Plan | Users | Price |
|------|-------|-------|
| Free | up to 3 | Rs 0 |
| Standard | first 3 included | Rs 1,000 per additional user per month |
| Third plan (Enterprise row) | n/a | coming soon: visible, refused at checkout |

The earlier launch / growth / scale plans are archived (kept for history). Modules and limits are identical across Free
and Standard (all modules); only the user allowance and price differ. **These limits are my assumption**, set in migration
054; change them there if a plan should differ.

## What exists

* Migration `054_seat_based_plans.sql`: plan availability / pricing model / included users, `paid_seats`,
  `pending_paid_seats`, `seat_overage_since`, `billing_seat_changes`; new organisations start on Free (trigger);
  organisations on the retired trial catalogue with no provider subscription moved to Free (internal / founder preview
  organisations untouched).
* `services/api/src/core/subscription-billing.js` and `razorpay.js`: seat counting (members + pending invitations),
  seat enforcement, checkout (provider plan created once, provider subscription with quantity = users beyond 3),
  signature-verified confirmation, seat changes (increase now; decrease at renewal, never below users in use),
  cancellation (at renewal or immediately), return to Free, webhook handling, billing profile with GSTIN validation.
* Enforcement points: creating an invitation, accepting one, re-activating a member. Serialised per organisation.
* Over-limit policy: after cancelling or downgrade with more users than the plan covers, a 14 day window, then the
  organisation is read-only (reads and exports still work) until users are removed or seats bought.
* Web: `/settings/billing` (plan, users, plan cards with live price, upgrade, change users, cancel, billing
  details, invoices, payments, user-change history), seat line on Invitations, `/api/billing/*` routes, Razorpay
  Checkout allowed in the CSP.

## Verification

* `tests/integration/billing-seats.test.mjs`: 18 subtests. Catalogue, pricing arithmetic, Free refuses a 4th user
  (pending invitations count; resend takes no seat; observe mode reports only), disable/re-activate, checkout
  validation and reuse, forged vs real signature, seat increase/decrease/renewal, webhooks (forged, duplicate, stale,
  another subscription's event), failed payment grace then read-only, cancel, over-limit window and lock, GSTIN,
  internal organisations unlimited.
* `apps/web/e2e/billing-plans.spec.ts`: Free owner sees 1 of 3, Standard price and live total (10 users = Rs 7,000),
  Free-tier quote, third plan not purchasable, GSTIN validation, a member without billing.view refused.
* Existing tests updated for the new default (registration and auto-provision now expect an active Free plan).
* Gates: `tsc`, `eslint`, route-security (webhook documented as signature-authenticated), billing mutation gate.

## Not done / needs you

* **Live payments are untested against Razorpay.** No keys exist here; the provider is faked with the real signature
  maths. Before switching `BILLING_CHECKOUT_ENABLED=true`, run a test-mode subscription end to end and confirm Razorpay's
  behaviour for quantity updates (`schedule_change_at`) and the webhook event names in `.env.example`.
* Webhook retry (`retryBillingWebhooks`) exists but nothing schedules it; failed events rely on Razorpay's own retries
  until a job is wired.
* The mobile billing screen still assumes the old flat-price catalogue and needs updating to the seat model.
* No proration preview, no yearly billing, no GST invoice PDF generation of our own (Razorpay's invoice link is shown).
* Enforcement defaults to `observe` outside production, so the Free 3-user limit only blocks when
  `BILLING_ENFORCEMENT_MODE=enforce` (production default). The browser 4th-invite refusal was not driven in an
  enforce-mode browser run; the domain test covers it.
