# CRM → Sales Opportunity-to-Quotation Contract (F023 → F036)

## Ownership
CRM owns the source opportunity. Sales owns quotation pricing, taxes, discounts, revisions, approval and commercial document lifecycle.

## Trigger
Authorized user invokes **Create quotation** from an open accessible opportunity.

## Contract
- Preconditions: CRM opportunity readable/open; account/customer context resolvable; user has CRM access and Sales quotation-create permission.
- Public command: Sales-owned quotation create/orchestration command with `sourceOpportunityId` and explicit idempotency key.
- Transaction boundary: CRM is not allowed to write Sales private tables. Sales creates the quotation atomically in its domain; linkage/result is returned/published.
- Retry: repeated same idempotency key returns the existing result/no-op rather than a duplicate quote.
- Failure: CRM opportunity remains unchanged; user sees actionable failure and retry/reconciliation state.
- Audit/event: actor, opportunity, destination quotation, request/correlation/idempotency IDs and failure/retry outcome.
- Reversal: quotation cancellation/revision follows Sales rules; it does not silently roll back CRM opportunity history.
- Reconciliation: CRM related-record view can query Sales public contract by `sourceOpportunityId`.

Sales F036 remains to be fully specified in Pass 2; this contract fixes the CRM side without pre-certifying the Sales implementation.
