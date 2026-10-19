// Record access scope per app (Roles & Permissions MVP, section 4): which records a role's permissions reach — Own, Team or Company.
//
// There is no separate scope engine: each app already enforces its own scope permissions on every list, record and export
// (crm.leads.view_all, sales.order.view_team, projects.time.view_own…). A scope level is the set of those permissions a role holds,
// so choosing "Team" in the role editor grants the app's team keys, "Company" its company-wide keys too, and "Own" neither. Odoo does
// the same with record rules attached to groups. Apps without owned records (Accounting, Stock, Quality…) have no scope here: their
// permissions are company-wide by nature, and the role decides only which actions are allowed.
//
// level   own      only the records the person owns or is assigned
//         team     plus the records of the teams they manage or belong to (where the app has teams)
//         company  every record in the company
import { ALL_PERMISSIONS } from "./catalog.js";

const known = new Set(ALL_PERMISSIONS);
const only = (keys) => Object.freeze(keys.filter((key) => known.has(key)));

export const RECORD_SCOPE_LEVELS = Object.freeze([
  { key: "own", label: "Own records", description: "Only the records they own or are assigned." },
  { key: "team", label: "Team records", description: "Their own records and their teams' records." },
  { key: "company", label: "Company-wide", description: "Every record in the company." },
]);

// app → { label, team: keys granted at Team and above, company: keys granted at Company only, own: keys granted at every level }
export const RECORD_SCOPES = Object.freeze({
  crm: Object.freeze({
    label: "CRM",
    records: "leads, deals, companies, contacts, tasks and follow-ups",
    own: only([]),
    team: only(["crm.tasks.view_team", "crm.follow_ups.view_team"]),
    company: only(["crm.records.view_all", "crm.leads.view_all", "crm.opportunities.view_all", "crm.accounts.view_all", "crm.contacts.view_all",
      "crm.customers.view_all", "crm.tasks.view_all", "crm.follow_ups.view_all"]),
  }),
  sales: Object.freeze({
    label: "Sales",
    records: "customers, quotations, orders, deliveries, invoices and returns",
    own: only([]),
    team: only(["sales.customers.view_team", "sales.quotation.view_team", "sales.order.view_team"]),
    company: only(["sales.customers.view_all", "sales.quotation.view_all", "sales.order.view_all", "sales.delivery.view_all", "sales.invoice.view_all",
      "sales.credit_note.view_all", "sales.return.view_all", "sales.reservation.view_all"]),
  }),
  procurement: Object.freeze({
    label: "Procurement",
    records: "purchase orders, suppliers and rejections",
    own: only([]),
    team: only([]),
    company: only(["procurement.po.view_all", "procurement.suppliers.view_all", "procurement.rejections.view_all"]),
  }),
  projects: Object.freeze({
    label: "Projects",
    records: "projects, timesheets and expenses",
    own: only(["projects.time.view_own", "projects.expenses.view_own"]),
    team: only(["projects.time.view_team", "projects.expenses.view_team"]),
    company: only(["projects.view_all"]),
  }),
});

const levelIndex = (level) => RECORD_SCOPE_LEVELS.findIndex((entry) => entry.key === level);

// The keys a level grants in an app (own ⊂ team ⊂ company).
export function recordScopeKeys(app, level) {
  const scope = RECORD_SCOPES[app];
  if (!scope) return [];
  const index = levelIndex(level);
  return [...scope.own, ...(index >= 1 ? scope.team : []), ...(index >= 2 ? scope.company : [])];
}

// The level a set of permissions gives in an app: Company when it holds any company-wide key, else Team when any team key, else Own.
// (Any company-wide key already widens what that resource shows, so the widest key held is the honest answer.)
export function recordScopeLevel(app, permissionKeys) {
  const scope = RECORD_SCOPES[app];
  if (!scope) return null;
  const held = new Set(permissionKeys);
  if (scope.company.some((key) => held.has(key))) return "company";
  if (scope.team.some((key) => held.has(key))) return "team";
  return "own";
}

// The permission keys with an app's scope set to `level`: its scope keys are replaced, every other key is kept.
export function withRecordScope(permissionKeys, app, level) {
  const scope = RECORD_SCOPES[app];
  if (!scope || levelIndex(level) < 0) return [...permissionKeys];
  const scopeKeys = new Set([...scope.own, ...scope.team, ...scope.company]);
  return [...new Set([...permissionKeys.filter((key) => !scopeKeys.has(key)), ...recordScopeKeys(app, level)])].sort();
}

// Which apps a set of permissions works in (any permission of the app), for showing only the scopes that matter to a role.
export function appsInPermissions(permissionKeys) {
  return Object.keys(RECORD_SCOPES).filter((app) => permissionKeys.some((key) => key.startsWith(`${app}.`)));
}
