# CRM navigation and information architecture

The CRM secondary sidebar lists **workspaces**, not features. It is built from
the one navigation registry (`apps/web/src/shell/navigation/module-navigation-registry.ts`)
through the route-ownership rules in `navigation-resolution.ts`. The same rules
drive the desktop sidebar, the mobile drawer, breadcrumbs, global search and the
CRM Setup hub.

## Permanent CRM sidebar

| Group | Workspace | Route | Shown to |
|---|---|---|---|
| Overview | Home | `/crm` | every CRM user |
| Customers | Leads · Accounts · Contacts | `/crm/leads` · `/crm/accounts` · `/crm/contacts` | every CRM user |
| Sales | Opportunities | `/crm/opportunities` | every CRM user |
| Work | My Work | `/crm/work` | every CRM user |
| Insights | Forecast | `/crm/forecast` | `crm.forecast.submit`, `.review` or `.manage` |
| Insights | Reports | `/crm/reports` | `crm.reports.view` |
| Administration | CRM Setup | `/crm/settings` | any setup permission (settings, teams, territories, coverage, data quality, privacy, import) |

Visibility reuses the permissions the underlying APIs already enforce; hiding is
UX only, every route and API still authorizes server-side. With the built-in
roles, a sales representative sees Home through Reports; CRM administrators and
sales operations also see CRM Setup; a sales manager sees CRM Setup with only
Sales Coverage (their `crm.coverage.view`).

## Where everything else lives

| Route | Owning workspace | Behaviour |
|---|---|---|
| `/crm/dashboard` | Home | Redirects to `/crm`, query kept (Home embeds the dashboard) |
| `/crm/pipeline` | Opportunities | Redirects to `/crm/opportunities?view=pipeline`, query kept |
| `/crm/opportunities?view=list\|pipeline` | Opportunities | List and Pipeline views of one workspace |
| `/crm/tasks`, `/calls`, `/meetings`, `/follow-ups` | My Work | Redirect to `/crm/work?view=…`, query kept (e.g. `?due=overdue`) |
| `/crm/communications` | My Work | Redirects to `/crm/work?view=inbox` |
| `/crm/tasks/[id]`, `/new` (and the other activity types) | My Work | Unchanged; highlight My Work |
| `/crm/reports?report=<key>&from=&to=` | Reports | One searchable, grouped Report picker; no report sidebar |
| `/crm/settings` (`#<category>` or `?section=<category>` jumps to one) | CRM Setup | Every setting listed directly on the page under its category heading; no setup sidebar |
| `/crm/settings/*`, `/crm/coverage`, `/crm/data/import-export`, `/crm/data/duplicates` | CRM Setup | Unchanged pages; breadcrumb shows the category |

CRM Setup categories (only real pages; a category with nothing the viewer may
open is not shown): Sales process · Routing & organization · Lead management ·
Data management · Customization · Communications & integrations · Governance.
There is no Automation & intelligence category yet because no CRM automation
configuration page exists.

## Rule for new capabilities

A new CRM capability does **not** automatically become a sidebar item. Ask:
*is this a distinct recurring workspace, or a view, action or configuration
inside an existing one?* Register views, lists, configuration pages and tools
with `parent` (and `group` for CRM Setup) so they stay routable, searchable and
breadcrumbed without growing the sidebar. Examples: Pipeline → Opportunities
view; Tasks/Calls/Meetings → My Work; sales stages, assignment rules,
territories, import/export → CRM Setup; a new report → the Reports picker; a
new KPI → Home or Reports.

`apps/web/src/shell/navigation/navigation.test.ts` enforces this: the exact
workspace list, a cap on permanent destinations, every non-workspace route
having a real parent, every registered route being a real page, and each
route highlighting exactly one workspace.
