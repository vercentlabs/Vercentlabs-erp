> Vercentlabs Landing Redesign — Phase 1, Workstream H
> Status: Decided. No search-volume figures are stated anywhere in this document — per the governing brief, search volume must never be invented. Intent and query *shape* are qualitative judgements based on the query families in [[seo-aeo-geo-architecture]], not measured data. Real volume/competition data should be pulled from Search Console/a keyword tool in Phase 6 before content production.

# Search Intent Map

| Query shape (illustrative, not exhaustive) | Intent | Owning page | Funnel stage |
|---|---|---|---|
| "vercentlabs", "vercentlabs erp" | Navigational | `/` | Any (branded) |
| "ERP software", "what is an ERP system" | Informational/category | `/` (primary), `/resources` (deep definitional content, Phase 6) | Awareness |
| "manufacturing ERP software", "ERP for manufacturers" | Commercial | `/industries/manufacturing`, `/modules/manufacturing` | Consideration |
| "inventory management software", "multi-location inventory software" | Commercial | `/modules/stock`, `/industries/distribution-retail` | Consideration |
| "retail ERP with POS", "distribution management system" | Commercial | `/industries/distribution-retail`, `/modules/point-of-sale` | Consideration |
| "project accounting software", "ERP for professional services" | Commercial | `/industries/professional-services`, `/modules/projects` | Consideration |
| "procurement software", "purchase order software" | Commercial | `/modules/procurement` | Consideration |
| "CRM and ERP together", "CRM software" | Commercial | `/modules/crm` | Consideration |
| "how does procure to pay work" | Informational (AEO-shaped) | `/workflows/procure-to-pay` | Consideration→Evaluation |
| "lead to cash process explained" | Informational (AEO-shaped) | `/workflows/lead-to-cash` | Consideration→Evaluation |
| "BOM to work order process" | Informational (AEO-shaped) | `/workflows/plan-to-production` | Consideration→Evaluation |
| "replace spreadsheets with ERP", "consolidate business software" | Informational/trigger-event | `/` (framing), `/resources` (Phase 6 guide) | Awareness→Consideration |
| "[category] vs [alternative]" | Comparison/evaluation | `/resources` (Phase 6; never a module page) | Evaluation |
| "ERP implementation time", "how long does ERP implementation take" | Informational | `/implementation` | Evaluation |
| "ERP security", "is [category] software secure" | Informational/risk | `/security` | Evaluation |
| "ERP pricing", "[category] cost" | Commercial | `/pricing` | Evaluation→Decision |
| "book ERP demo", "[product] demo" | Transactional | `/book-demo`, `/product-tour` | Decision |

## Cannibalisation checks applied

- "inventory management software" is owned by `/modules/stock`, not duplicated on `/industries/distribution-retail` (which instead targets the compound "retail/distribution ERP" intent and links to `/modules/stock` for the narrower query).
- Workflow pages own process-informational intent; module pages do not attempt to also rank for "how does X work" — they state what the module does, not the step-by-step process (that's the workflow page's job).
- Comparison intent is deliberately routed to `/resources` (Phase 6), never to module/industry pages, to avoid thin, repeated "Vercentlabs vs X" blocks scattered across the site.

## Explicit non-goals

No query family targets a specific city/region (rejects the location-page-farming risk named in the governing brief). No query family is served by more than one owning page. No search-volume or ranking-difficulty number appears in this document, or should be fabricated in any later phase without a real data source cited.
