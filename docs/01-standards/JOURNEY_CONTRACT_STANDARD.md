# Cross-Module Journey Contract Standard

Every handoff specifies: trigger; source aggregate and state; owning module; destination module; public command/query; authorization; validation; transaction boundary; idempotency key; retry policy; failure result; compensation/reversal; audit event; outbox/event contract; resulting records; user-visible status; reconciliation; E2E evidence; UAT evidence.

No journey may depend on direct private-table writes across module boundaries.
