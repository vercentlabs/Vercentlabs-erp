# Search Intent Ownership

Per `docs/landing-redesign/phase-1/information-architecture.md`'s anti-cannibalisation rule: one page owns one query family. Every `searchIntent` value below is stored directly in `packages/landing-content/src/modules.js` and verified unique by an automated test (`packages/landing-content/tests/module-content.test.mjs`, "every module has unique metadata").

## Module pages

| Route | Primary intent | Buyer stage | Main entity | Related pages |
|---|---|---|---|---|
| `/modules/crm` | "CRM ERP" | Consideration | Vercentlabs CRM module | `/modules/sales`, `/modules/support`, `/product` |
| `/modules/sales` | "Sales management ERP" | Consideration | Vercentlabs Sales module | `/modules/crm`, `/modules/accounting`, `/modules/stock` |
| `/modules/accounting` | "Accounting ERP" | Consideration/decision | Vercentlabs Accounting module | `/modules/sales`, `/modules/procurement`, `/security` |
| `/modules/procurement` | "Procurement ERP software" | Consideration | Vercentlabs Procurement module | `/modules/accounting`, `/modules/stock`, `/modules/quality` |
| `/modules/stock` | "Inventory and warehouse ERP" | Consideration | Vercentlabs Stock module | `/modules/manufacturing`, `/modules/point-of-sale`, `/modules/sales` |
| `/modules/manufacturing` | "Manufacturing ERP" | Consideration | Vercentlabs Manufacturing module | `/modules/stock`, `/modules/quality`, `/modules/accounting` |
| `/modules/projects` | "Project management ERP" | Consideration | Vercentlabs Projects module | `/modules/accounting`, `/modules/procurement`, `/modules/hr-payroll` |
| `/modules/assets` | "Asset management ERP" | Consideration | Vercentlabs Assets module | `/modules/procurement`, `/modules/stock`, `/modules/support` |
| `/modules/point-of-sale` | "Point of sale ERP" | Consideration | Vercentlabs Point of Sale module | `/modules/stock`, `/modules/sales` |
| `/modules/quality` | "Quality management ERP" | Consideration | Vercentlabs Quality module | `/modules/procurement`, `/modules/manufacturing`, `/modules/stock`, `/modules/sales` |
| `/modules/support` | "Customer support ERP" | Consideration | Vercentlabs Support module | `/modules/crm`, `/modules/sales`, `/modules/assets`, `/modules/projects`, `/modules/quality` |
| `/modules/hr-payroll` | "HR and payroll ERP" | Consideration | Vercentlabs HR & Payroll module | `/modules/accounting`, `/modules/projects` |

## Platform pages

| Route | Primary intent | Buyer stage |
|---|---|---|
| `/product` | "connected ERP", "multi-module ERP platform" | Awareness/consideration |
| `/modules` | "ERP modules" | Consideration |
| `/product/platform` | "multi-company ERP" | Consideration |
| `/product/automation` | "ERP workflow automation" | Consideration |
| `/product/analytics` | "ERP reporting and analytics" | Consideration |
| `/product/mobile` | "mobile ERP" | Consideration/decision |
| `/product/integrations` | "ERP integrations" | Decision |
| `/security` | "ERP security", "role-based access control ERP" | Decision (buying-committee risk diligence) |

## Cannibalisation checks performed

- **Against each other**: no two of the 19 new pages share a `searchIntent` or `metaDescription` — enforced by the same automated test.
- **Against Phase 3's homepage**: the homepage owns branded + category-level intent ("ERP software", "operational ERP") and links out to every module/platform page rather than trying to rank for their specific intents itself.
- **Against not-yet-built Phase 5 pages**: `/industries/*`, `/workflows/*`, `/pricing`, `/product-tour` don't exist yet, so nothing built this phase competes with their eventual intent — module pages describe capability depth, not industry fit or step-by-step workflow narrative (that's explicitly workflow/industry-page territory, referenced but not duplicated).
- **`/security` vs `/product/platform`**: both touch access control, but `/security` owns the buying-committee risk-diligence intent (roles/permissions/audit/MFA-honesty as a dedicated trust page) while `/product/platform` owns the architectural "how does multi-tenancy work" intent — the roles/permissions and audit-trail capability groups in the traceability registry point to `/security` specifically (not `/product/platform`) to keep this split unambiguous at the data level, not just in prose.
