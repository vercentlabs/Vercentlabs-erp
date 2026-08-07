# Route and Page Inventory — Phase 4

All routes below are new this phase (32 pages), except `/` and `/book-demo` (Phase 3, listed for context). Route architecture follows `docs/landing-redesign/phase-1/information-architecture.md` exactly, not the abbreviated example list in Prompt 4's own text — see `decision-log.md` item 1 for why.

## Product and module pages

| Route | Purpose | Audience | Search intent | H1 | Primary CTA | Screenshot(s) | Structured data | Indexation |
|---|---|---|---|---|---|---|---|---|
| `/product` | Explain the platform architecture beneath the 12 modules, in more depth than the homepage | All 3 ICPs, technical evaluators | "connected ERP", "multi-module ERP platform" | "One connected system, not twelve separate applications with a shared login screen." | Book a Product Demo | `crm-pipeline-board` (hero) | WebPage, FAQPage, BreadcrumbList (via Breadcrumbs) | Indexed |
| `/modules` | Module index — category grouping, operating stacks, adoption model | All 3 ICPs | "ERP modules" | "Twelve modules. One shared platform. Adopt what you need." | Book a Product Demo | none (index page) | CollectionPage, BreadcrumbList | Indexed |
| `/modules/crm` | CRM module authority page | Sales reps/managers, marketing ops, RevOps | "CRM ERP" | CRM | Book a Product Demo (`?module=crm`) | `crm-pipeline-board`, `crm-leads-list` | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/sales` | Sales module authority page | Sales reps/managers, finance approvers | "Sales management ERP" | Sales | Book a Product Demo (`?module=sales`) | `sales-quotation-detail`, `sales-order-detail` | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/accounting` | Accounting module authority page | Controllers/CFOs, AP/AR clerks | "Accounting ERP" | Accounting | Book a Product Demo (`?module=accounting`) | `sales-order-detail` (secondary evidence only — see Honest Limitations note below) | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/procurement` | Procurement module authority page | Procurement/purchasing managers | "Procurement ERP software" | Procurement | Book a Product Demo (`?module=procurement`) | none yet | WebPage, BreadcrumbList | Indexed |
| `/modules/stock` | Stock module authority page | Warehouse/inventory staff | "Inventory and warehouse ERP" | Stock | Book a Product Demo (`?module=stock`) | `stock-overview` | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/manufacturing` | Manufacturing module authority page | Production planners, plant managers | "Manufacturing ERP" | Manufacturing | Book a Product Demo (`?module=manufacturing`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/projects` | Projects module authority page | Project/delivery managers, PMO | "Project management ERP" | Projects | Book a Product Demo (`?module=projects`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/assets` | Assets module authority page | Facilities/IT/operations managers | "Asset management ERP" | Assets | Book a Product Demo (`?module=assets`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/point-of-sale` | Point of Sale module authority page | Store cashiers, shift supervisors | "Point of sale ERP" | Point of Sale | Book a Product Demo (`?module=point-of-sale`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/quality` | Quality module authority page | QA inspectors, QA managers | "Quality management ERP" | Quality | Book a Product Demo (`?module=quality`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/support` | Support module authority page | Support agents, team leads | "Customer support ERP" | Support | Book a Product Demo (`?module=support`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |
| `/modules/hr-payroll` | HR & Payroll module authority page | HR managers, payroll preparers | "HR and payroll ERP" | HR & Payroll | Book a Product Demo (`?module=hr-payroll`) | none yet | WebPage, FAQPage, BreadcrumbList | Indexed |

## Platform pages

| Route | Purpose | Search intent | H1 | Screenshot | Indexation |
|---|---|---|---|---|---|
| `/product/platform` | Platform architecture deep dive | "multi-company ERP" | "One control plane, twelve modules." | none | Indexed |
| `/product/automation` | Workflow automation deep dive | "ERP workflow automation" | "Automated where it matters, governed everywhere." | none | Indexed |
| `/product/analytics` | Reporting & analytics deep dive | "ERP reporting and analytics" | "Reports read from the same data your teams work in — not a separate copy." | none | Indexed |
| `/product/mobile` | Mobile ERP scope, stated honestly | "mobile ERP" | "Native where it counts. Honest about where it doesn't, yet." | none | Indexed |
| `/product/integrations` | Integrations & APIs, separated by type | "ERP integrations" | "Real integration mechanisms, clearly labeled by what they actually are." | none | Indexed |
| `/security` | Security & governance architecture (canonical) | "ERP security", "role-based access control ERP" | "The controls a buying committee actually asks about." | none | Indexed |
| `/product/security` | — | — | — | — | 301 → `/security` (permanent) |

## Notes on the module screenshot gap

9 of 12 module pages ship with no product screenshot yet (Procurement, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll — Accounting has one secondary/borrowed evidence reference but no dedicated capture). This is a real, honest gap, not a bug: `ProductEvidenceSection` renders nothing when no screenshot is approved for a module (the same honest-empty-state discipline established in Phase 3), and `ModuleHero` falls back to a `workflow-led` or `operational-sequence` layout instead of showing an empty screenshot slot. A background screenshot-capture attempt this phase stalled and failed before producing usable captures — see `screenshot-extension-register.md` and `phase-5-brief.md` for the retry plan.

## Explicitly not built this phase

`/product-tour`, `/pricing`, `/about`, `/contact`, `/implementation`, `/legal/privacy`, `/legal/terms`, `/industries/*`, `/workflows/*`, any resource-centre/glossary/comparison route — see `decision-log.md` for the reasoning per route, and `phase-5-brief.md` for what's next.
