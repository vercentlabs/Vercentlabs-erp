# CRM Journey — Prospect to Opportunity

Trigger: prospect enters CRM. Owner: CRM.

Flow: capture -> source/provenance -> duplicate review -> assignment -> qualification/stage/scoring -> activities/follow-up -> conversion preview -> atomic conversion to account/contact/opportunity.

Controls: record scope, deterministic qualification policy, duplicate resolution, optimistic concurrency, conversion idempotency, transaction rollback, audit/outbox and reconciliation.

Failure: any conversion failure leaves the source lead unchanged; retry uses the same idempotency identity.
