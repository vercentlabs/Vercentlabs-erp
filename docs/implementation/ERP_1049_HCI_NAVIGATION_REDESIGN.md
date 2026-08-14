# Vercentlabs ERP — HCI Navigation Redesign

## Scope

The product handbook is 1,049 pages: 1,039 canonical planned features plus 10 guide/index pages.
Accounting is the later 12th business module and remains separate from the historical 1,039 denominator.

This navigation architecture is designed for the complete end-state product without ever exposing 1,039 individual menu entries.

## Core hierarchy

1. Primary product rail
2. Context/module sidebar
3. Workspace page / record
4. Feature action inside that page

Examples:

- CRM -> Leads -> Lead -> assign / score / qualify / convert / merge / audit
- Procurement -> Purchase orders -> Purchase order -> amend / approve / receive / cancel / print
- Manufacturing -> Work orders -> Work order -> release / reserve / issue / report / complete / rework

Actions stay in pages. The navigation describes places, not every possible verb.

## HCI principles applied

### Visibility of system status
The active module and active destination are continuously visible on desktop. Breadcrumbs remain in place.

### Match between system and the real world
Navigation names use business concepts such as Leads, Requisitions, Receipts, Work orders, Payroll runs and Quality holds rather than technical route names.

### User control and freedom
The primary rail expands on hover and keyboard focus without changing layout width. Mobile provides an explicit Back to all navigation control. Search can be cleared with Escape.

### Consistency and standards
Every business module uses the same interaction grammar:
module -> grouped workspaces -> page -> action.

### Error prevention
The presentation never creates a route. It receives the server-resolved navigation array and only groups/filters those existing NavigationItem objects.

### Recognition rather than recall
Module icons are permanently visible on desktop; labels appear on hover/focus; the active module's internal destinations stay visible in a second sidebar.

### Flexibility and efficiency
Ctrl/Cmd+K, Quick Create, My Work, Recent Records and Favourites remain intact as expert accelerators.

### Aesthetic and minimalist design
The rail exposes only high-level product areas. The secondary sidebar exposes only the current context. Individual feature actions stay out of navigation.

### Orientation and recovery
Breadcrumbs, active states, module identity and mobile Back navigation preserve wayfinding.

### Accessibility
Hover has an equivalent focus-within behavior; links keep accessible text; visible focus indicators are global; mobile uses the existing focus-trapped dialog; reduced motion is respected.

## Choice-load strategy

The design intentionally avoids presenting hundreds of peer choices. It uses progressive disclosure and semantic chunking:

- 12 business modules are recognizable global areas.
- Each module exposes a small number of workspaces.
- Each workspace owns the many related canonical capabilities.
- Search and command palette bypass hierarchy for known-item seeking.

This reduces working-memory load and supports both novice browsing and expert recall.

## Desktop

- Primary rail: 68px
- Hover/focus expansion: 244px overlay
- Module/context sidebar: 276px
- 1024–1180px context sidebar: 240px
- Expanded primary rail never changes grid track width and therefore never reflows tables or content.

## Mobile

Below 961px the two fixed sidebars are removed.

The existing accessible mobile drawer now contains:
- Workspace
- My Work
- Modules
- Governance
- Administration

Selecting a module opens a second in-drawer view for that module's authorized workspaces.

## Security boundary

Unchanged.

`resolveNavigation()` remains server-side and continues to consume module entitlement/access and permission decisions before the client receives navigation.

The new rail and context sidebar:
- do not import permissions,
- do not query access state,
- do not fetch unfiltered destinations,
- do not create routes,
- do not replace ModulePageGuard/API authorization.

## Module grouping

- CRM: Customers, Sales, Engagement, Insights, Administration
- Sales: Selling, Insights, Administration
- Accounting: General ledger, Receivables, Payables, Treasury, Fixed assets, Planning, Tax, Operations, Period close, Insights, Administration
- Procurement: Demand, Sourcing, Suppliers, Purchasing, Receiving, Invoice control, Insights, Administration
- Stock: Inventory, Warehouse operations, Traceability, Availability, Planning
- Manufacturing: Product engineering, Production, Resources, Planning
- Projects: Delivery, Time & cost, Insights
- Assets: Asset lifecycle, Maintenance, Financial
- Point of Sale: Sell, Store operations, Configuration
- Quality: Setup, Quality control, Supplier quality, Governance
- Support: Service, Service levels, Engagement, Knowledge
- HR & Payroll: People, Time, Expenses, Compensation, Payroll

Business modules, services, database schema and APIs are intentionally untouched.

## V3 — iconography, Home and topbar

### Future-feature readiness

The double-sidebar shell is complete independently of feature completion.

The shell never requires one navigation entry per handbook capability. Future
implemented capabilities should be added in one of two ways:

1. as actions/tabs/sections inside an existing workspace; or
2. as a real new workspace route added to the canonical navigation registry.

The module grouping layer uses existing `NavigationItem.group` metadata as a
fallback, so a newly shipped route can participate without rewriting the shell.
A not-yet-implemented capability is not shown as a clickable fake route.

### Icon system

All 12 module headings now use their dedicated module glyph:
CRM, Sales, Accounting, Procurement, Stock, Manufacturing, Projects, Assets,
Point of Sale, Quality, Support and HR & Payroll.

Leaf navigation uses route-aware semantic glyphs. Unrelated workspaces no longer
share generic module/check/audit icons. The same icon is intentionally reused
only when the user concept is genuinely the same, such as Reports or Settings.

### ERP Home

Home is intentionally not a catalogue of 1,039 capabilities. That would violate
recognition-over-recall and increase choice load.

Home instead surfaces:
- current operating context,
- what needs attention,
- canonical accessible business modules,
- global Find anything,
- My Work,
- recent records,
- favourites,
- organisation overview,
- common administration actions,
- assigned work,
- audit events.

Module launch cards are derived from `getAccessibleModules()` and the canonical
module catalogue. They therefore respect enablement, entitlement and permission
without inventing roadmap availability.

### Topbar

The topbar is split into four semantic zones:
1. workspace identity / mobile navigation,
2. global search,
3. organisation/company/branch operating context,
4. create/notification/profile actions.

Desktop uses one row when space allows. Narrow desktop/tablet moves context to a
second row. Mobile keeps identity/actions first, search second and operating
context third. At very narrow widths the context selectors wrap instead of
causing page overflow.
