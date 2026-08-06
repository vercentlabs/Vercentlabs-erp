> Vercentlabs Landing Redesign — Phase 1, Workstream G
> Status: Decided. Supersede only via a new decision entry in `decision-log.md`.

# Information Architecture

## Repository taxonomy reconciliation

The governing brief's product-scope list names 11 modules and folds accounting-like concerns implicitly. The actual repository (`apps/web/src/app/(app)/**`, `services/api/src/**`, `database/*/migrations/*.sql`) implements **Accounting as its own module**, distinct from Sales, giving **12 operational modules**. Per the brief's own instruction ("use the actual latest repository taxonomy... do not stop to debate 11 vs 12"), this IA uses 12: CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets, Point of Sale, Quality, Support, HR & Payroll. Logged in [[decision-log]].

## Site map

```text
/
├── /product
│   ├── /product/platform          (shared platform: multi-tenancy, multi-company, permissions, approvals, audit)
│   ├── /product/automation        (workflow & business rule engine)
│   ├── /product/analytics         (reporting & dashboard framework)
│   ├── /product/mobile            (native mobile access)
│   ├── /product/security          (security architecture — merges with /security, see redirect note)
│   └── /product/integrations      (public API, webhooks, integrations)
│
├── /modules
│   ├── /modules/crm
│   ├── /modules/sales
│   ├── /modules/accounting
│   ├── /modules/procurement
│   ├── /modules/stock
│   ├── /modules/manufacturing
│   ├── /modules/projects
│   ├── /modules/assets
│   ├── /modules/point-of-sale
│   ├── /modules/quality
│   ├── /modules/support
│   └── /modules/hr-payroll
│
├── /industries
│   ├── /industries/manufacturing
│   ├── /industries/distribution-retail
│   └── /industries/professional-services
│
├── /workflows
│   ├── /workflows/lead-to-cash
│   ├── /workflows/quote-to-order
│   ├── /workflows/procure-to-pay
│   ├── /workflows/plan-to-production
│   ├── /workflows/inventory-to-replenishment
│   ├── /workflows/project-to-profitability
│   └── (remaining flagship workflows ship in Phase 5, see priority table)
│
├── /product-tour
├── /implementation
├── /security                       (canonical; /product/security 301s here)
├── /pricing
├── /resources                      (hub for guides, FAQs, comparison content — SEO/AEO surface)
├── /book-demo
├── /contact
├── /about
└── /legal (/legal/privacy, /legal/terms)
```

Explicitly **not** built as standalone pages: a `/solutions` tier separate from `/industries` and `/workflows` (would duplicate intent — a "solution" in this product's case *is* either an industry framing or a workflow framing, not a third thing), and per-feature pages for each of the 1,039 requirements (feature detail lives inside module pages as capability groups, not as its own URL tier).

## Navigation and mega menu

Primary nav: **Product** (mega menu) · **Modules** (mega menu) · **Industries** · **Pricing** · **Resources** · **Book a Demo** (button, primary CTA, persistent).

**Modules mega menu grouping** (avoids a flat 12-item list, groups by buyer mental model rather than internal engineering order):
- *Revenue*: CRM, Sales, Point of Sale
- *Operations*: Procurement, Stock, Manufacturing, Quality
- *Finance*: Accounting, Assets
- *People & Service*: HR & Payroll, Support
- *Delivery*: Projects

**Product mega menu**: Platform, Automation, Analytics, Mobile, Security, Integrations — plus a persistent "See it work: Product Tour" link.

Mobile nav collapses to the same six top-level groups behind a single accordion; Book a Demo stays fixed/sticky per [[conversion-architecture]].

## Page specifications

### Tier 0 — Core conversion pages

| Page | Audience | Buyer stage | Search intent | Purpose | Core question answered | Primary CTA | Structured data | Priority |
|---|---|---|---|---|---|---|---|---|
| `/` | All 3 ICPs | Awareness→consideration | Branded + "[category] software" | Convert cold and warm traffic; route to the right module/industry | "What is this and is it for me?" | Book a Demo | Organization, WebSite, SoftwareApplication | P0 |
| `/book-demo` | Qualified visitors | Decision | Branded, high-intent | Convert to sales conversation | "How do I talk to someone?" | Submit demo request | None (form page, noindex-friendly but kept indexable for brand queries) | P0 |
| `/pricing` | Consideration/decision | Commercial intent | "[category] pricing" | Set expectations, qualify | "What will this cost?" | Book a Demo | FAQPage (pricing FAQs) | P0 |
| `/product-tour` | Consideration | Product-research intent | "[product] demo", "[product] tour" | Self-serve product understanding before a call | "What does it actually look like?" | Book a Demo | VideoObject if video exists | P0 |

### Tier 1 — Module pages (12)

Common template for every `/modules/{slug}` page — audience: the module's primary persona (see [[product-intelligence]] per-module target users); buyer stage: consideration; search intent: "[module] software", "[module] ERP module"; purpose: prove depth in this specific domain; core question: "does it do what I actually need in this area?"; proof required: real screenshots/workflow walkthroughs for that module (no fabricated metrics); primary CTA: Book a Demo, secondary: relevant workflow page; supporting pages: the industries and workflows that reference this module; structured data: SoftwareApplication (module-level) + breadcrumb; implementation priority: **P1** for CRM, Sales, Accounting, Stock, Procurement (highest ICP relevance across all three profiles); **P2** for Manufacturing, Projects, Point of Sale, HR & Payroll (ICP-specific depth); **P3** for Assets, Quality, Support (cross-cutting, lower standalone search volume — still required, ships after P1/P2).

### Tier 2 — Industry pages (3)

| Page | Maps to ICP | Primary modules featured | Primary CTA | Priority |
|---|---|---|---|---|
| `/industries/manufacturing` | ICP 1 | Manufacturing, Stock, Procurement, Quality, Accounting | Book a Demo | P0 |
| `/industries/distribution-retail` | ICP 2 | Stock, Point of Sale, Sales, Procurement, CRM | Book a Demo | P0 |
| `/industries/professional-services` | ICP 3 | Projects, CRM, Sales, Accounting, HR & Payroll | Book a Demo | P1 |

### Tier 3 — Workflow pages

Cross-module workflow pages are the AEO/GEO backbone (they answer "how does X actually work end to end", which is exactly the shape of an answer-engine query). Six ship first (one per ICP-relevant flagship flow plus the two most universally searched); the remaining flagship workflows identified in [[product-intelligence]] ship in Phase 5 per the roadmap, not invented here.

| Page | Spans modules | Priority |
|---|---|---|
| `/workflows/lead-to-cash` | CRM, Sales, Accounting | P0 |
| `/workflows/quote-to-order` | Sales, Accounting | P0 |
| `/workflows/procure-to-pay` | Procurement, Accounting | P0 |
| `/workflows/plan-to-production` | Manufacturing, Stock | P1 |
| `/workflows/inventory-to-replenishment` | Stock, Procurement | P1 |
| `/workflows/project-to-profitability` | Projects, Accounting, HR & Payroll | P1 |

### Tier 4 — Trust and operational pages

`/security`, `/implementation`, `/about`, `/legal/*` — audience: buying-committee members doing risk diligence (IT, finance, legal), not the primary demand-gen surface. Search intent is low-volume but high-conversion-value (a security page visited late in the funnel is a strong buying signal). Priority **P0** for `/security` and `/implementation` (explicitly required by the conversion architecture's objection-handling stage), **P1** for `/about` and `/legal/*`.

### Tier 5 — Resources hub

`/resources` — the AEO/GEO content-authority surface (buyer FAQs, comparison tables, definitions, implementation guides). Detailed content-type planning is deferred to Phase 6 (SEO/AEO/GEO content-authority system) per the roadmap; this phase only reserves the URL and states its purpose: informational-intent capture that funnels into module/industry/workflow pages, never a competitor of them.

## Anti-cannibalisation rules applied

- A capability (e.g. "approval workflows") is described once in depth on `/product/platform` and referenced, not re-explained, from every module page.
- A workflow that touches a module is *linked from* that module page, not duplicated as module-page content.
- Industry pages reuse module and workflow content via composition (embedding the same proof blocks) rather than rewriting module claims per industry.
- No feature-level URL exists for any of the 1,039 individual requirements — they live as capability-group content inside their module page.
