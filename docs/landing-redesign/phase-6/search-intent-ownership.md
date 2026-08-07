# Search Intent Ownership — Phase 6

Follows the same anti-cannibalisation rule as Phase 4/5's docs of the same name: one page owns one query family. Every `searchIntent` value below is stored directly in its content file and checked for uniqueness within its own collection by an automated test (`resource-content.test.mjs`, `comparison-content.test.mjs`); cross-collection uniqueness (e.g. a resource guide vs. a module page) is checked by `packages/landing-content/scripts/check-cannibalization.mjs` and the manual review in `cannibalisation-review.md`.

## Resource guides

| Route | Primary intent | Buyer stage |
|---|---|---|
| `/resources/erp-buying-guide` | "how to choose ERP software" | Evaluation |
| `/resources/erp-requirements-checklist` | "ERP requirements checklist" | Evaluation |
| `/resources/erp-implementation-checklist` | "ERP implementation checklist" | Decision/implementation planning |
| `/resources/erp-migration-guide` | "ERP data migration process" | Decision/implementation planning |
| `/resources/manufacturing-erp-guide` | "manufacturing ERP software" | Awareness/evaluation |
| `/resources/erp-vs-spreadsheets` | "ERP vs spreadsheets" | Awareness |

## Glossary standalone pages

| Route | Primary intent |
|---|---|
| `/resources/glossary/erp` | "what is ERP" |
| `/resources/glossary/crm` | "what is CRM" |
| `/resources/glossary/mrp` | "what is MRP" |
| `/resources/glossary/bom` | "what is a bill of materials" |
| `/resources/glossary/reorder-point-and-safety-stock` | "reorder point safety stock" |
| `/resources/glossary/three-way-match` | "what is three-way matching" |
| `/resources/glossary/purchase-requisition` | "what is a purchase requisition" |
| `/resources/glossary/rbac` | "what is RBAC" |
| `/resources/glossary/maker-checker` | "what is maker-checker" |
| `/resources/glossary/multi-tenant-saas` | "what is multi-tenant SaaS" |
| `/resources/glossary/multi-company-erp` | "what is multi-company ERP" |

## Compare

| Route | Primary intent | Buyer stage |
|---|---|---|
| `/compare/vercentlabs-vs-odoo` | "Vercentlabs vs Odoo" | Decision |

## Cannibalisation checks performed this phase

- **Within each new collection**: automated (unique `searchIntent`/`metaDescription`/title tests in `resource-content.test.mjs`, `glossary-content.test.mjs`, `comparison-content.test.mjs`).
- **Across all ~74 routes**: `check-cannibalization.mjs` (exact/near-duplicate title scan) plus the manual 8-item review in `cannibalisation-review.md`. One real collision found and fixed (`/solutions/workflow-automation` renamed); one pre-empted by design (glossary's Lead to Cash/Procure to Pay stayed index-only); one accepted as non-conflicting (`/modules/manufacturing` vs. `/industries/manufacturing`, both titled "Manufacturing" but different entity types/breadcrumbs/intent).
- **Resource guides against existing pages**: `/resources/erp-implementation-checklist` explicitly differentiated from `/implementation` (generic vs. Vercentlabs-specific, enforced by a dedicated test); `/resources/manufacturing-erp-guide` differentiated from `/industries/manufacturing` (software-capability framing vs. buyer-company-fit framing); `/resources/erp-vs-spreadsheets` differentiated from `/solutions/replace-spreadsheets` and the homepage's spreadsheets messaging (vendor-neutral education vs. Vercentlabs-specific solution vs. top-of-funnel pitch).
- **Glossary against workflow pages**: the index-only/standalone split exists specifically to prevent the glossary cluster from cannibalizing the workflow cluster — see `glossary-architecture.md`.
