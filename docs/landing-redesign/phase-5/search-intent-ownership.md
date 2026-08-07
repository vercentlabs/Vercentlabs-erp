# Search Intent Ownership — Phase 5 Extension

Extends `docs/landing-redesign/phase-1/seo-aeo-geo-architecture.md`'s intent-ownership map with the 19 new Phase 5 routes. One page owns one query family — no cannibalisation against existing (Phase 3/4) or reserved (Phase 6) routes.

## Industries

| Route | Owns | Explicitly does NOT compete with |
|---|---|---|
| `/industries/manufacturing` | "manufacturing ERP software", "ERP for small manufacturers" | `/modules/manufacturing` (module capability, not industry operating model) |
| `/industries/distribution` | "distribution management system" | `/industries/retail` (shares an ICP but leads with Procurement/replenishment, not checkout) |
| `/industries/retail` | "retail ERP with POS" | `/industries/distribution`; `/modules/point-of-sale` (module capability, not industry framing) |
| `/industries/professional-services` | "ERP for professional services", "project profitability software" | `/modules/projects` |

## Solutions

| Route | Owns | Explicitly does NOT compete with |
|---|---|---|
| `/solutions/replace-spreadsheets` | "replace spreadsheets with ERP software" | `/product` (overview capability vs. this page's problem-first framing); homepage `PROBLEM_SECTION` (this page goes deeper) |
| `/solutions/connect-business-operations` | "connect business operations software" | `/product/platform` (capability-first vs. this page's problem-first framing); `/solutions/multi-company-management` (cross-module handoffs vs. multi-entity isolation — different problems) |
| `/solutions/multi-company-management` | "multi-company ERP software" | `/product/platform`; `/solutions/connect-business-operations` |
| `/solutions/workflow-automation` | "business process automation software" | `/product/automation` |
| `/solutions/real-time-business-reporting` | "real-time business reporting software" | `/product/analytics` |

## Workflows

| Route | Owns | Explicitly does NOT compete with |
|---|---|---|
| `/workflows/lead-to-cash` | "lead to cash process" | `/workflows/order-to-fulfilment` (this page covers CRM→Sales origination through invoicing; order-to-fulfilment covers the order/warehouse/invoice tail specifically) |
| `/workflows/procure-to-pay` | "procure to pay process" | `/solutions/connect-business-operations` (this page is the full cited sequence; the solution page cites it as one example among several) |
| `/workflows/order-to-fulfilment` | "order to fulfillment process" | `/workflows/lead-to-cash` (see above) |
| `/workflows/plan-to-production` | "plan to production process", "BOM to work order" | `/modules/manufacturing` |
| `/workflows/project-to-profitability` | "project profitability workflow" | `/industries/professional-services` (industry framing vs. this page's process framing) |
| `/workflows/hire-to-payroll` | "hire to payroll process" | `/modules/hr-payroll` |

## Implementation

| Route | Owns | Explicitly does NOT compete with |
|---|---|---|
| `/implementation` | "ERP implementation methodology", "ERP data migration" | Nothing else on the site addresses implementation risk directly — this is the sole owner of that intent family. |

## Reserved for Phase 6 (not built, not to be duplicated by any Phase 5 page)

Comparison pages ("Vercentlabs vs. X"), a resource centre/blog, and a glossary remain unbuilt. No Phase 5 page attempts to cover comparison or glossary-style definitional intent even in passing FAQ content — FAQs stay scoped to the specific page's own subject.
