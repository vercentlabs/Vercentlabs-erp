# Stage 4 — Sales execution and quotation governance

Stage 4 extends the existing Sales quotation engine without replacing its
authoritative pricing, tax, approval, immutable-version, public-decision or
quotation-to-order conversion contracts.

It adds:

- configurable quotation SLA and completeness policy;
- deterministic quotation health and commercial readiness evaluation;
- lifecycle governance snapshots for create, revise, submit, send and convert;
- quotation operations dashboard and attention queue;
- full quotation timeline aggregation across versions, events, approvals,
  decisions and governance snapshots;
- governed version comparison with margin redaction;
- draft-only bulk owner and validity changes, capped at 200 records;
- personal and shared saved quotation views;
- tenant isolation and forced row-level security;
- web API contracts and existing secure mobile browser-handoff verification;
- unit, API, migration, database, tenant and live verification gates.

Migration: `020_sales_quotation_governance.sql`.
