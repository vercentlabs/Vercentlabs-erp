# VercentLabs four-module implementation programme

This programme tracks the complete benchmarked capability surface for the four currently released modules: CRM, Sales, Accounting and Procurement.

## Non-negotiable sequence

1. **Wave 0 — correctness and control hardening**
   - Shared sign-correct financial decimal arithmetic.
   - Procurement server-owned lifecycle, optimistic concurrency, governed matching tolerances and relational validation.
   - Accounting close governance, strict settings validation and complete audit coupling.
   - Billing checkout/webhook crash recovery and concurrency safety.
   - Mobile idempotency, retry backoff and terminal failure handling.
   - Real database, concurrency, HTTP and browser tests.
2. **Wave 1 — complete current-module execution**
   - CRM provider integrations, shared inbox, campaign execution and seller work queue.
   - Sales commercial approvals, contracts, pricing controls and India tax behaviour.
   - Accounting India localisation, payments, bank feeds and AP/AR automation.
   - Procurement supplier onboarding, budget checks, supplier portal and normalized procure-to-pay links.
3. **Wave 2 — physical-flow dependency**
   - Build the Stock foundation required by Sales fulfilment and Procurement receiving/matching: stock ledger, UOM conversion, reservations, ATP, serial/lot, pick/pack/ship, delivery, return and stock accounting.
4. **Wave 3 — competitive depth**
   - CRM intelligence and customer success.
   - Sales recurring billing, returns, incentives and customer portal.
   - Accounting advanced close, lease/revenue accounting, treasury and consolidation.
   - Procurement strategic sourcing, contracts, supplier collaboration and analytics.

## Source of truth

`four-module-feature-register.json` contains every benchmarked capability with module, subdomain, status, priority, implementation wave, current evidence and recommended implementation. The verification script fails if required fields or unique capability keys are lost.

## Definition of done for a capability

A capability is not complete merely because a route, table or screen exists. Completion requires:

- strict input schema;
- permission and organisation/company scope;
- transaction and concurrency design;
- idempotency for retryable writes;
- immutable audit/event history;
- migration and rollback strategy;
- API and UI implementation;
- database-backed behavioural tests;
- operating metrics and failure recovery;
- user documentation and acceptance scenarios.
