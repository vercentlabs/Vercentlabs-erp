# GEO Entity Architecture

How Vercentlabs ERP's content maps as a real entity graph — the canonical names, aliases, and relationships an answer engine or crawler should be able to resolve consistently across every page. This doc exists so copy stays consistent (rule 6 of `.claude/rules/landing-content.md`) — not so every page repeats the same phrasing, but so the same concept is never named two different ways without a documented reason.

## Entity hierarchy

```
Vercentlabs (Organization)
└── Vercentlabs ERP (SoftwareApplication, @id = /#software)
    ├── Platform (shared capabilities, not a module)
    │   ├── Multi-Tenancy / Multi-Company & Branch Isolation
    │   ├── RBAC (Role-Based Access Control)
    │   ├── Approval Workflows (command registry)
    │   ├── Immutable Audit Trail
    │   ├── Reporting & Analytics
    │   ├── Mobile ERP
    │   └── Integrations & APIs
    ├── 12 Modules (see table below)
    ├── Cross-Module Workflows (12 total; 6 routed to a real page)
    ├── Industries (4: Manufacturing, Distribution, Retail, Professional Services)
    ├── Solutions (5: buyer-problem framings, each paired to exactly one Platform page)
    ├── Resources (cornerstone guides, glossary, comparisons)
    └── Evidence (product screenshots, EDITORIAL_SOURCES, ComparisonEvidence)
```

## Canonical module names (never rephrase)

| Canonical name | Module key | Do NOT use instead |
|---|---|---|
| CRM | `crm` | "Customer Relationship" module |
| Sales | `sales` | "Order Management" |
| Accounting | `accounting` | "Finance" (Accounting is its own module in this repo's taxonomy, distinct from a generic "Finance" umbrella) |
| Procurement | `procurement` | "Purchasing" |
| Stock | `stock` | "Inventory Management" — a documented alias (see below), not a rename |
| Manufacturing | `manufacturing` | "Production" |
| Projects | `projects` | "Project Management" |
| Assets | `assets` | "Fixed Assets" |
| Point of Sale | `point-of-sale` | "POS" is an acceptable short form, not a rename |
| Quality | `quality` | "QA" |
| Support | `support` | "Helpdesk" |
| HR & Payroll | `hr-payroll` | "Human Resources" alone (Payroll is explicitly part of the module name) |

## Documented aliases (safe to use interchangeably, with the canonical name stated at least once per page)

- **Stock** ≡ "Inventory Management" / "Warehouse Management" — common buyer search terms; the module's own name stays "Stock" in navigation and headings, but body copy and metadata may use "Inventory Management" where it matches real search intent (see `search-intent-ownership.md`).
- **Procurement** ≡ "Purchasing" — acceptable in body copy for readability, not in headings/navigation.
- **HR & Payroll** ≡ "Workforce Management" — acceptable only when payroll isn't the specific topic of the sentence.
- **Lead to Cash** ≡ "Quote to Cash" in general industry usage — Vercentlabs' own workflow is named "Lead to Cash" (starts from lead capture, not just quoting) and that's the only name used on-site; "Quote to Cash" is not used as a synonym because it would misdescribe the workflow's actual starting point.
- **Order to Cash** (glossary index term) ≡ the fulfilment/billing half of the revenue cycle — routed on-site to `/workflows/order-to-fulfilment`, not a separate page, since that page already covers this exact scope.

## Canonical workflow names (the 6 routed pages)

Lead to Cash · Procure to Pay · Order to Fulfilment · Plan to Production · Project Planning to Profitability · Hire to Payroll — used verbatim in every internal link's anchor text, breadcrumb, and metadata title referencing these workflows.

## Resolved naming collision

`/solutions/workflow-automation` and `/product/automation` (the platform page) both used to render the title "Workflow Automation" — a real entity-clarity collision found while building this document. The solution page's display name was changed to **"Automate Governed Workflows"** (Phase 6 decision-log item 7); the platform page keeps "Workflow Automation" as the canonical name for that capability. Both pages still link to each other (`relatedPlatformPageSlug`), so the relationship stays intact — only the ambiguous duplicate title was removed.

## Glossary term ↔ page relationship

Glossary terms are **not** a competing entity naming system. Every standalone glossary page (`ERP`, `CRM`, `MRP`, `BOM`, `Reorder Point & Safety Stock`, `Three-Way Match`, `Purchase Requisition`, `RBAC`, `Maker-Checker`, `Multi-Tenant SaaS`, `Multi-Company ERP`) either defines a concept with no other dedicated page on the site, or — where a fuller page already exists (`Lead to Cash`, `Procure to Pay`) — stays index-only and links straight to that real page instead of creating a second, competing definition. See `glossary-architecture.md`.

## Comparison entity naming

Odoo is referred to consistently as "Odoo" (not "Odoo ERP," "Odoo S.A.," or a version-specific name) except where quoting or citing a specific official source, matching how Odoo names itself on its own primary pages (see `EDITORIAL_SOURCES`).

## Author and organization entities

- **Organization**: "Vercentlabs" (existing `organizationJsonLd()` in `apps/landing/lib/seo/json-ld.ts`).
- **SoftwareApplication**: "Vercentlabs ERP," `@id = /#software` (existing, declared once on the homepage).
- **Content author**: "Vercentlabs Product Team" (`CONTENT_AUTHORS`) — a truthful organizational byline, not an invented individual. See `author-and-review-policy.md`.
