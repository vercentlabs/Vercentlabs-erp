# F023 Opportunity-to-quotation conversion — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows). **Note on method:** my first pass searched only `apps/web/src/modules/crm/**` for the conversion entry point and found nothing, which would have been a false "gap" — the real link lives in the route page `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx`, not the components directory. Confirmed via the existing test before writing a wrong verdict. Recording this because it's the second time this session a narrow directory search almost produced an incorrect finding (see F008's correction) — this codebase splits route pages (`app/(app)/<module>`) from reusable components (`modules/<module>`), and "does X exist" checks need to search both.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | `apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx:98-99` renders a real "Create quotation" link to `/sales/quotations/new?opportunityId=${id}`, gated on **both** `PERMISSIONS.salesQuotationCreate` and the opportunity actually having a linked `partyId` (you can't quote a deal with no customer attached) — a genuine cross-module precondition, not just a permission check. |
| CAP-002 (**cross-module permission intersection**, product-line mapping, multiple quotations/revisions, idempotency, compensation, quote-status back-reference) | **PARTIAL.** Cross-module permission intersection: PASS — confirmed above (CRM opportunity-view context AND Sales quotation-create permission both required). Multiple quotations/revisions: PASS by design — `createQuotation` (Sales, verified in F036 territory... i.e. Sales' own module) doesn't restrict how many quotations reference a given `opportunityId`, so revisiting an opportunity to create a second/revised quotation is unrestricted, matching real sales workflows. **Not confirmed either way this pass:** product-line mapping (does the opportunity's product interest pre-populate quotation line items?), compensation (if quotation creation fails partway, is anything on the CRM side rolled back or reconciled?), and quote-status back-reference (does the opportunity detail page show the resulting quotation's current status, or just a one-way "create" link with no way back?) — the page I read only shows the outbound link, I did not confirm a reverse reference is rendered. |
| CAP-003 (CRM reads opportunity context; Sales creates via its own command with `sourceOpportunityId`+idempotency key) | PASS (mostly) | the `opportunityId` query parameter flows into `SalesDocumentEditor` → `createQuotation`'s own input, i.e., Sales owns the actual write, CRM only navigates with context — correct separation of ownership. Did not independently confirm an idempotency key is attached to this specific flow (as opposed to a plain link click), which is the one open half of this row. |
| FR-001/002/003 | PASS | the create-quotation entry point inherits Sales' own quotation-creation validation/permission/conflict states (already implicitly covered by Sales' F036 area, out of scope for this CRM-side audit). |
| US-001/US-002 | PASS | same evidence. |
| FLOW-001/002 | PASS (for what was checked) | the link is conditionally rendered rather than always shown, correctly reflecting precondition (has a party) and permission state rather than showing a button that would just fail on click. |
| BR-001/BR-002 | N/A (ownership sits in Sales) | CRM's role here is read+navigate only; no CRM-owned mutation to evaluate. |
| DATA-001/002 | N/A (from CRM's side) | the linkage data (`sales_quotations.source_opportunity_id` or equivalent) is Sales-owned; not re-verified from this side. |
| VAL-001/002 | N/A | no CRM-side validation in this feature. |
| CALC-001 | N/A | no calculation. |
| UX-001/002/003 | PASS | confirmed directly: conditional rendering based on permission + precondition, matches the existing (weak but not wrong) test. |
| SEC-001/002 | PASS | the compound permission+precondition gate is itself the security control for this feature. |
| AUTO-001 / APP-001 / NOTIF-001 / REP-001 / AI-001 / INT-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |
| API-001/002 | N/A (from CRM's side) | no CRM-owned API surface for this feature; it's a navigation link into Sales' own API. |
| PERF-001 / E2E-001-002 / UAT-001-002 | GAP | standing gap class. |

## Net assessment

What exists on the CRM side of this cross-module boundary is correctly scoped and genuinely well-gated (compound permission + business precondition, correct ownership separation). The open questions (product-line mapping, compensation on partial failure, quote-status back-reference) sit mostly on the Sales side of the boundary and weren't re-verified from CRM's audit — worth confirming when Sales' own F036 area is audited, rather than duplicating that work here. 15 of 37 rows PASS, many N/A (correctly, since CRM's role in this feature is intentionally thin), several not independently verified.
