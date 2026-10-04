// The canonical, single-authority module secondary-navigation registry.
// The desktop secondary sidebar, the mobile drawer's per-module section,
// and the command menu must all read from this file — none may define a
// parallel nav list.
//
// STATUS HONESTY: an item is AVAILABLE only once its screen is built and
// verified working end-to-end — never flip one speculatively. PLANNED items
// render in the secondary sidebar disabled, for orientation, never as a
// clickable link — see SecondarySidebar.tsx.
//
// Sections are grouped around the user's work model, not a literal
// F-id-per-item mapping; each is annotated with the coarse F-id range it
// corresponds to.
import {
  Users,
  ShoppingCart,
  Truck,
  Boxes,
  Factory,
  FolderKanban,
  Wrench,
  Store,
  BadgeCheck,
  LifeBuoy,
  Landmark,
  Building2,
  CalendarClock,
  ShieldCheck,
  SlidersHorizontal,
  UserSearch,
  Workflow,
} from "lucide-react";

import type { ModuleNavigation, SecondaryNavItem } from "./navigation-types";

function planned(label: string, route: string): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "PLANNED" };
}

function available(label: string, route: string): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "AVAILABLE" };
}

function adminOnly(
  label: string,
  route: string,
  requiredPermission: string,
): SecondaryNavItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return { id, label, route, status: "PLANNED", requiredPermission };
}

export const MODULE_NAVIGATION: readonly ModuleNavigation[] = [
  {
    moduleKey: "crm",
    label: "CRM",
    icon: Users,
    requiredPermission: "crm.view",
    // The CRM sidebar: twelve destinations in five groups. Everything else is
    // a view, an action or a configuration page inside one of them, registered
    // with `parent`: still routed, searchable and breadcrumbed, never a
    // sidebar entry of its own. Qualification, assignment, conversion, stage
    // changes, duplicate handling and won/lost happen on the records.
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/crm"),
          { ...available("Dashboard", "/crm/dashboard"), parent: "home", aliases: ["kpi", "metrics"] },
          { ...available("Lead Dashboard", "/crm/leads/dashboard"), parent: "leads" },
          { ...available("Opportunity Dashboard", "/crm/opportunities/dashboard"), parent: "opportunities", aliases: ["win rate", "won and lost"] },
        ],
      },
      {
        id: "customers-sales",
        label: "Customers & Sales",
        items: [
          available("Leads", "/crm/leads"),
          available("Accounts", "/crm/accounts"),
          available("Contacts", "/crm/contacts"),
          available("Opportunities", "/crm/opportunities"),
          { ...available("Pipeline", "/crm/pipeline"), aliases: ["board", "kanban", "deals"] },
        ],
      },
      {
        id: "work",
        label: "Work",
        items: [
          { ...available("Tasks", "/crm/tasks"), requiredPermission: "crm.tasks.view" },
          { ...available("Follow-ups", "/crm/follow-ups"), requiredPermission: "crm.follow_ups.view", aliases: ["reminders"] },
          { ...available("Notes & Files", "/crm/notes-files"), aliases: ["notes", "attachments", "documents", "files"] },
          // Earlier work screens: reachable by search and link, not sidebar entries.
          { ...available("My Work", "/crm/work"), parent: "tasks", aliases: ["today"] },
          { ...available("Calls", "/crm/calls"), parent: "follow-ups" },
          { ...available("Meetings", "/crm/meetings"), parent: "follow-ups" },
          { ...available("Inbox", "/crm/communications"), parent: "follow-ups", aliases: ["communications", "email", "conversations"] },
        ],
      },
      {
        id: "insights",
        label: "Insights",
        items: [
          { ...available("Reports", "/crm/reports"), aliases: ["leads by status", "opportunities by stage"] },
          {
            ...available("Forecast", "/crm/forecast"),
            parent: "reports",
            requiredAnyPermission: ["crm.forecast.submit", "crm.forecast.review", "crm.forecast.manage"],
          },
        ],
      },
      {
        id: "administration",
        label: "Administration",
        items: [
          {
            ...available("Data Quality", "/crm/data-quality"),
            aliases: ["duplicates", "merge", "potential duplicates"],
            requiredPermission: "crm.duplicates.review",
          },
          {
            ...available("CRM Settings", "/crm/settings"),
            aliases: ["setup", "configuration", "administration"],
            // Shown to anyone who can open at least one destination inside it;
            // each destination keeps its own permission below.
            requiredAnyPermission: [
              "crm.settings.manage",
              "crm.opportunities.manage_close_reasons",
              "crm.leads.manage_stages",
              "crm.leads.manage_assignment_rules",
              "crm.teams.manage",
              "crm.territories.manage",
              "crm.coverage.view",
              "crm.privacy.manage",
              "crm.import",
            ],
          },
          // ---- Lead Management
          {
            ...available("Lead Stages & Statuses", "/crm/settings/leads/stages"),
            parent: "crm-settings",
            group: "lead-management",
            description: "The steps a lead moves through, and the four statuses it can end in.",
            aliases: ["lead stages", "lead pipeline", "lead process"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Qualification Criteria", "/crm/settings/leads/qualification"),
            parent: "crm-settings",
            group: "lead-management",
            description: "What must be known about a lead before it can be qualified.",
            aliases: ["qualification requirements", "bant", "lead qualification"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Assignment Rules", "/crm/settings/leads/assignment"),
            parent: "crm-settings",
            group: "lead-management",
            description: "Route new leads to owners and teams, with round robin and a fallback queue.",
            aliases: ["routing", "round robin", "lead assignment"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Lead Sources", "/crm/settings/leads/sources"),
            parent: "crm-settings",
            group: "lead-management",
            description: "Where leads come from, for routing and attribution.",
            requiredPermission: "crm.settings.manage",
          },
          // ---- Opportunity Management
          {
            ...available("Sales Stages", "/crm/settings/opportunities/stages"),
            parent: "crm-settings",
            group: "opportunity-management",
            description: "The stages of the pipeline and their default probabilities.",
            aliases: ["pipeline stages", "probability"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Won / Lost Reasons", "/crm/settings/opportunities/close-reasons"),
            parent: "crm-settings",
            group: "opportunity-management",
            description: "The reasons a deal can be won or lost.",
            aliases: ["outcome reasons", "close reasons", "lost reasons", "won reasons"],
            requiredPermission: "crm.opportunities.manage_close_reasons",
          },
          // ---- Data Quality
          {
            ...available("Duplicate Detection Rules", "/crm/settings/data-quality"),
            parent: "crm-settings",
            group: "data-quality",
            description: "What makes two leads, contacts or accounts a strong or a possible duplicate.",
            aliases: ["duplicate rules", "matching"],
            requiredPermission: "crm.settings.manage",
          },
          // ---- Defaults
          {
            ...available("Task Defaults", "/crm/settings/defaults/tasks"),
            parent: "crm-settings",
            group: "defaults",
            description: "The priority and reminder a new task starts with.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Follow-up Defaults", "/crm/settings/defaults/follow-ups"),
            parent: "crm-settings",
            group: "defaults",
            description: "The type and reminder a new follow-up starts with.",
            requiredPermission: "crm.settings.manage",
          },
          // ---- Earlier configuration pages, kept reachable in one group.
          {
            ...available("Qualification / Playbooks", "/crm/settings/playbooks"),
            parent: "crm-settings",
            group: "more",
            description: "Qualification questions and the playbooks sellers follow.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Territories & Sales Teams", "/crm/settings/territories"),
            parent: "crm-settings",
            group: "more",
            description: "Teams, hierarchy, territories, forecast periods and quotas.",
            aliases: ["territory", "sales teams", "quotas"],
            requiredAnyPermission: ["crm.teams.manage", "crm.territories.manage", "crm.forecast.manage"],
          },
          {
            ...available("Sales Coverage", "/crm/coverage"),
            parent: "crm-settings",
            group: "more",
            description: "Who covers what, coverage gaps and unassigned work.",
            aliases: ["reassign", "unassigned"],
            requiredPermission: "crm.coverage.view",
          },
          {
            ...available("Imports & Exports", "/crm/data/import-export"),
            parent: "crm-settings",
            group: "more",
            description: "Import leads from a file and export CRM data.",
            aliases: ["import", "export", "csv"],
          },
          {
            ...available("Custom Fields & Tags", "/crm/settings/custom-fields-and-tags"),
            parent: "crm-settings",
            group: "more",
            description: "Extra fields and tags on leads, accounts and deals.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Custom Record Fields", "/crm/settings/record-fields"),
            parent: "crm-settings",
            group: "more",
            description: "Fields on custom CRM record types.",
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Meeting Links", "/crm/settings/meeting-links"),
            parent: "crm-settings",
            group: "more",
            description: "Public booking links and their availability.",
            aliases: ["booking", "calendar"],
            requiredPermission: "crm.settings.manage",
          },
          {
            ...available("Data Subject Requests", "/crm/settings/data-requests"),
            parent: "crm-settings",
            group: "more",
            description: "Access, export and erasure requests about CRM records.",
            aliases: ["privacy", "consent", "gdpr", "dsr"],
            requiredPermission: "crm.privacy.manage",
          },
        ],
      },
    ],
    groups: [
      {
        id: "lead-management",
        workspace: "crm-settings",
        label: "Lead Management",
        description: "Lead stages and statuses, qualification, assignment and sources.",
        icon: UserSearch,
      },
      {
        id: "opportunity-management",
        workspace: "crm-settings",
        label: "Opportunity Management",
        description: "Sales stages and the reasons deals are won or lost.",
        icon: Workflow,
      },
      {
        id: "data-quality",
        workspace: "crm-settings",
        label: "Data Quality",
        description: "How duplicate leads, contacts and accounts are detected.",
        icon: ShieldCheck,
      },
      {
        id: "defaults",
        workspace: "crm-settings",
        label: "Defaults",
        description: "What a new task or follow-up starts with.",
        icon: CalendarClock,
      },
      {
        id: "more",
        workspace: "crm-settings",
        label: "More configuration",
        description: "Teams and territories, imports, custom fields, booking links and privacy requests.",
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    moduleKey: "sales",
    label: "Sales",
    icon: ShoppingCart,
    requiredPermission: "sales.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/sales"),
          available("Settings", "/sales/settings"),
        ],
      },
      {
        id: "selling",
        label: "Selling",
        featureRange: "F031-F040",
        items: [
          available("Customers", "/sales/customers"),
          available("Products & Services", "/sales/products"),
          available("Quotations", "/sales/quotations"),
          available("Sales Orders", "/sales/orders"),
          planned("Availability", "/sales/availability"),
        ],
      },
      {
        id: "fulfillment",
        label: "Fulfillment",
        featureRange: "F041-F046",
        items: [available("Deliveries", "/sales/deliveries")],
      },
      {
        id: "billing",
        label: "Billing",
        featureRange: "F047-F052",
        items: [
          available("Invoices", "/sales/invoices"),
          available("Credit / Adjustments", "/sales/credit-adjustments"),
        ],
      },
      {
        id: "commercial",
        label: "Commercial",
        featureRange: "F055-F058",
        items: [
          available("Price Lists", "/sales/price-lists"),
          available("Discounts", "/sales/discounts"),
          available("Terms", "/sales/terms"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F059-F062",
        items: [available("Order Status", "/sales/order-status")],
      },
    ],
  },
  {
    moduleKey: "procurement",
    label: "Procurement",
    icon: Truck,
    requiredPermission: "procurement.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/procurement"),
          available("Settings", "/procurement/settings"),
        ],
      },
      {
        id: "requests",
        label: "Requests",
        featureRange: "F063-F066",
        items: [available("Approval Queue", "/procurement/approval-queue")],
      },
      {
        id: "purchasing",
        label: "Purchasing",
        featureRange: "F073-F078",
        items: [available("Purchase Orders", "/procurement/orders")],
      },
      {
        id: "receiving",
        label: "Receiving",
        featureRange: "F079-F082",
        items: [
          available("Goods Receipts", "/procurement/receipts"),
          available("Rejections", "/procurement/rejections"),
        ],
      },
      {
        id: "invoices-cost",
        label: "Invoices & Cost",
        featureRange: "F083-F086",
        items: [
          available("Supplier Invoices", "/procurement/invoices"),
          available("Three-Way Match", "/procurement/three-way-match"),
        ],
      },
      {
        id: "suppliers",
        label: "Suppliers",
        featureRange: "F087-F090",
        items: [
          available("Supplier Master", "/procurement/suppliers"),
          available("Categories", "/procurement/categories"),
        ],
      },
    ],
  },
  {
    moduleKey: "stock",
    label: "Inventory",
    icon: Boxes,
    requiredPermission: "stock.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/inventory")],
      },
      {
        id: "items",
        label: "Items",
        featureRange: "F097-F102",
        items: [
          available("Items", "/inventory/items"),
          available("Variants", "/inventory/variants"),
          available("Categories", "/inventory/categories"),
          available("Units of Measure", "/inventory/units-of-measure"),
          available("Unit Conversions", "/inventory/conversions"),
        ],
      },
      {
        id: "stock",
        label: "Stock",
        featureRange: "F103-F108",
        items: [
          available("Availability", "/inventory/availability"),
          available("Stock Ledger", "/inventory/ledger"),
          available("Reservations", "/inventory/reservations"),
        ],
      },
      {
        id: "warehouses",
        label: "Warehouses",
        featureRange: "F109-F111",
        items: [
          available("Warehouses", "/inventory/warehouses"),
          available("Locations / Bins", "/inventory/locations"),
        ],
      },
      {
        id: "operations",
        label: "Operations",
        featureRange: "F112-F118",
        items: [
          available("Receipts", "/inventory/receipts"),
          available("Issues", "/inventory/issues"),
          available("Transfers", "/inventory/transfers"),
          available("Adjustments", "/inventory/adjustments"),
        ],
      },
      {
        id: "traceability",
        label: "Traceability",
        featureRange: "F119-F125",
        items: [
          available("Lots / Batches", "/inventory/lots"),
          available("Serial Numbers", "/inventory/serial-numbers"),
          available("Quarantine", "/inventory/quarantine"),
        ],
      },
      {
        id: "counting",
        label: "Counting",
        featureRange: "F126-F128",
        items: [
          available("Physical Inventory", "/inventory/physical-inventory"),
        ],
      },
      {
        id: "valuation",
        label: "Valuation",
        featureRange: "F133-F138",
        items: [
          available("Costing", "/inventory/costing"),
          available("Inventory Valuation", "/inventory/valuation"),
          available("Movement", "/inventory/movement"),
        ],
      },
    ],
  },
  {
    moduleKey: "manufacturing",
    label: "Manufacturing",
    icon: Factory,
    requiredPermission: "manufacturing.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/manufacturing")],
      },
      {
        id: "engineering",
        label: "Engineering",
        featureRange: "F145-F151",
        items: [
          available("BOMs", "/manufacturing/boms"),
          available("BOM Versions", "/manufacturing/bom-versions"),
        ],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F152-F157",
        items: [
          available(
            "Material Availability",
            "/manufacturing/material-planning",
          ),
        ],
      },
      {
        id: "production",
        label: "Production",
        featureRange: "F158-F165",
        items: [
          available("Production Orders", "/manufacturing/production-orders"),
        ],
      },
      {
        id: "materials",
        label: "Materials",
        featureRange: "F166-F170",
        items: [
          available("Reservations", "/manufacturing/reservations"),
          available("Consumption", "/manufacturing/consumption"),
        ],
      },
      {
        id: "output",
        label: "Output",
        featureRange: "F171-F175",
        items: [
          available("Finished Output", "/manufacturing/finished-output"),
          available("Scrap", "/manufacturing/scrap"),
        ],
      },
      {
        id: "quality",
        label: "Quality",
        featureRange: "F176-F177",
        items: [available("Inspections", "/manufacturing/inspections")],
      },
      {
        id: "resources",
        label: "Resources",
        featureRange: "F178-F181",
        items: [available("Settings", "/manufacturing/settings")],
      },
      {
        id: "cost",
        label: "Cost",
        featureRange: "F182-F186",
        items: [
          available("Standard Cost", "/manufacturing/standard-cost"),
          available("Production Cost", "/manufacturing/production-cost"),
          available("Variance", "/manufacturing/variance"),
        ],
      },
    ],
  },
  {
    moduleKey: "projects",
    label: "Projects",
    icon: FolderKanban,
    requiredPermission: "projects.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/projects")],
      },
      {
        id: "projects",
        label: "Projects",
        featureRange: "F193-F196",
        items: [available("All Projects", "/projects/all")],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F197-F203",
        items: [
          available("Tasks", "/projects/tasks"),
          available("Milestones", "/projects/milestones"),
          available("Workspace (WBS, Gantt, Board)", "/projects/workspace"),
        ],
      },
      {
        id: "team",
        label: "Team",
        items: [available("Project Team", "/projects/team")],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F209-F210",
        items: [
          available("Time Entries", "/projects/time"),
          available("Timesheets", "/projects/timesheets"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        items: [available("Settings", "/projects/settings")],
      },
    ],
  },
  {
    moduleKey: "assets",
    label: "Assets",
    icon: Wrench,
    requiredPermission: "assets.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/assets")],
      },
      {
        id: "assets",
        label: "Assets",
        featureRange: "F231-F234",
        items: [
          available("Asset Register", "/assets/register"),
          available("Asset Categories", "/assets/categories"),
        ],
      },
      {
        id: "acquisition",
        label: "Acquisition",
        featureRange: "F235-F237",
        items: [
          available("Acquisition", "/assets/acquisition"),
          available("Capitalization", "/assets/capitalization"),
        ],
      },
      {
        id: "custody",
        label: "Custody",
        featureRange: "F238-F241",
        items: [
          available("Assignments", "/assets/assignments"),
          available("Transfers", "/assets/transfers"),
          available("Locations", "/assets/locations"),
        ],
      },
      {
        id: "value",
        label: "Value",
        featureRange: "F242-F245",
        items: [available("Depreciation", "/assets/depreciation")],
      },
      {
        id: "maintenance",
        label: "Maintenance",
        featureRange: "F246-F250",
        items: [
          available("Maintenance Plans", "/assets/maintenance-plans"),
          available("Work Orders", "/assets/work-orders"),
        ],
      },
      {
        id: "disposal",
        label: "Disposal",
        featureRange: "F255-F257",
        items: [
          available("Retirement", "/assets/retirement"),
          available("Disposal / Sale", "/assets/disposal"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        items: [
          adminOnly(
            "Asset Settings",
            "/assets/settings",
            "assets.settings.manage",
          ),
        ],
      },
    ],
  },
  {
    moduleKey: "point-of-sale",
    label: "POS",
    icon: Store,
    requiredPermission: "pos.view",
    sections: [
      { id: "overview", label: "Overview", items: [available("Home", "/pos")] },
      // In-transaction checkout mode hides ordinary ERP nav for a focused
      // surface — "Open POS" is deliberately not a normal
      // secondary-nav destination among these, it's a distinct mode.
      {
        id: "sell",
        label: "Sell",
        featureRange: "F277-F282",
        items: [
          available("Open POS", "/pos/checkout"),
          available("Transactions", "/pos/transactions"),
        ],
      },
      {
        id: "stores",
        label: "Stores",
        featureRange: "F268-F271",
        items: [
          {
            ...available("Stores", "/pos/stores"),
            requiredPermission: "pos.store.manage",
          },
          {
            ...available("Terminals", "/pos/terminals"),
            requiredPermission: "pos.terminal.manage",
          },
          {
            ...available("Cashiers", "/pos/cashiers"),
            requiredPermission: "pos.store.manage",
          },
          {
            ...available("Settings", "/pos/settings"),
            requiredPermission: "pos.settings.manage",
          },
        ],
      },
      {
        id: "discounts",
        label: "Discounts",
        featureRange: "F279-F281",
        items: [
          {
            ...available("Discount Approvals", "/pos/discount-approvals"),
            requiredPermission: "pos.discount.approve",
          },
        ],
      },
      {
        id: "cash",
        label: "Cash",
        featureRange: "F278-F282",
        // "Day Close" was removed as a separate nav destination
        // (consolidation, not a build): closing a day's business is already
        // two real, complete operations elsewhere -- ending a shift (Shifts,
        // pos.shift.close) and generating/reviewing/finalizing that day's
        // immutable Z report (/pos/reports/day-end, F303) -- and a third
        // screen for the same underlying "close the day" operation would
        // just be a second front door onto one of those, not new capability.
        items: [
          available("Shifts", "/pos/shifts"),
          available("Cash Movement", "/pos/cash-movement"),
        ],
      },
      {
        id: "returns",
        label: "Returns",
        featureRange: "F291-F292",
        items: [available("Returns", "/pos/returns")],
      },
      {
        id: "inventory",
        label: "Inventory",
        featureRange: "F291-F294",
        items: [
          // F294/F295/F296: one consolidated read-only workspace (store
          // availability + lot/batch + real-time stock-sync activity) --
          // a single coherent inventory-visibility capability, not two
          // destinations.
          available("POS Inventory", "/pos/inventory"),
        ],
      },
      {
        id: "insights",
        label: "Insights",
        featureRange: "F295-F307",
        // F303: day-end (Z) reports has a real screen now (list, generate,
        // review/finalize, print) -- flipped to AVAILABLE. Ordinary ad hoc
        // POS reporting (pos.reports.view) still has no screen yet.
        items: [
          available("Day-end (Z) Reports", "/pos/reports/day-end"),
          // F304: cross-report exception queue + settlement-evidence
          // import; generating a report's own reconciliation happens from
          // that report's detail screen.
          {
            ...available("Reconciliation", "/pos/reconciliation"),
            requiredPermission: "pos.reconciliation.view",
          },
          // F305: every completed sale/return's GL posting status, with
          // retry for anything failed.
          {
            ...available("Accounting Posting", "/pos/accounting"),
            requiredPermission: "pos.accounting.view",
          },
        ],
      },
    ],
  },
  {
    moduleKey: "quality",
    label: "Quality",
    icon: BadgeCheck,
    requiredPermission: "quality.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/quality")],
      },
      {
        id: "planning",
        label: "Planning",
        featureRange: "F308-F312",
        items: [available("Quality Plans", "/quality/plans")],
      },
      {
        id: "inspections",
        label: "Inspections",
        featureRange: "F313-F318",
        items: [
          available("Inspections", "/quality/inspections"),
          available("Open Inspections", "/quality/open-inspections"),
        ],
      },
      {
        id: "non-conformance",
        label: "Non-Conformance",
        featureRange: "F319-F329",
        items: [
          available("Non-Conformances", "/quality/nonconformances"),
          available("Quality Holds", "/quality/holds"),
        ],
      },
    ],
  },
  {
    moduleKey: "support",
    label: "Support",
    icon: LifeBuoy,
    requiredPermission: "support.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/support")],
      },
      {
        id: "tickets",
        label: "Tickets",
        featureRange: "F343-F350",
        items: [
          available("My Tickets", "/support/my-tickets"),
          available("All Tickets", "/support/tickets"),
          available("Unassigned", "/support/unassigned"),
          available("Categories", "/support/categories"),
        ],
      },
    ],
  },
  {
    moduleKey: "hr-payroll",
    label: "HR & Payroll",
    icon: Landmark,
    requiredPermission: "hr_payroll.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [
          available("Home", "/hr"),
          available("My Profile", "/hr/me"),
          available("Settings", "/hr/settings"),
        ],
      },
      {
        id: "people",
        label: "People",
        featureRange: "F381-F386",
        items: [
          available("Employees", "/hr/employees"),
          available("Organization", "/hr/organization"),
          available("Departments", "/hr/departments"),
          available("Positions", "/hr/positions"),
        ],
      },
      {
        id: "joining",
        label: "Joining",
        items: [available("Onboarding", "/hr/onboarding")],
      },
      {
        id: "time",
        label: "Time",
        featureRange: "F399-F404",
        items: [
          available("Attendance", "/hr/attendance"),
          available("My Attendance", "/hr/my-attendance"),
          available("Shifts", "/hr/shifts"),
          available("Shift Assignments", "/hr/shift-assignments"),
          available("Holiday Calendars", "/hr/holiday-calendars"),
          available("Holidays", "/hr/holidays"),
        ],
      },
      {
        id: "leave",
        label: "Leave",
        featureRange: "F405-F409",
        items: [
          available("Leave Requests", "/hr/leave-requests"),
          available("My Leave", "/hr/my-leave"),
          available("Team Leave", "/hr/team-leave"),
          available("Balances", "/hr/leave-balances"),
          available("My Balances", "/hr/my-leave-balances"),
          available("Policies", "/hr/leave-policies"),
          available("Leave Types", "/hr/leave-types"),
          available("Leave Administration", "/hr/leave-admin"),
        ],
      },
      {
        id: "compensation",
        label: "Compensation",
        featureRange: "F410-F414",
        items: [
          available("Salary Structures", "/hr/salary-structures"),
          available("Compensation", "/hr/compensation"),
          available("Pay Components", "/hr/pay-components"),
        ],
      },
      {
        id: "payroll",
        label: "Payroll",
        featureRange: "F415-F422",
        items: [
          available("Payroll", "/hr/payroll"),
          available("Payroll Runs", "/hr/payroll-runs"),
          available("Payroll Periods", "/hr/payroll-periods"),
          available("Exceptions", "/hr/payroll-exceptions"),
          available("Payslips", "/hr/payslips"),
          available("My Payslips", "/hr/my-payslips"),
        ],
      },
    ],
  },
  {
    moduleKey: "accounting",
    label: "Accounting",
    icon: Building2,
    requiredPermission: "accounting.view",
    sections: [
      {
        id: "overview",
        label: "Overview",
        items: [available("Home", "/accounting")],
      },
      {
        id: "ledger",
        label: "Ledger",
        featureRange: "F453-F458",
        items: [
          available("Chart of Accounts", "/accounting/chart-of-accounts"),
          available("Journals", "/accounting/journals"),
          available("General Ledger", "/accounting/general-ledger"),
          available("Fiscal Periods", "/accounting/fiscal-periods"),
          available("Close Checklist", "/accounting/close-checklist"),
        ],
      },
      {
        id: "receivables",
        label: "Receivables",
        featureRange: "F459-F464",
        items: [
          available("Customer Invoices", "/accounting/customer-invoices"),
          available("Receipts", "/accounting/receipts"),
        ],
      },
      {
        id: "payables",
        label: "Payables",
        featureRange: "F465-F470",
        items: [
          available("Supplier Invoices", "/accounting/supplier-invoices"),
          available("Payments", "/accounting/payments"),
        ],
      },
      {
        id: "banking",
        label: "Banking",
        featureRange: "F471-F475",
        items: [
          available("Bank Accounts", "/accounting/bank-accounts"),
          available("Bank Statements", "/accounting/bank-transactions"),
          available("Reconciliation", "/accounting/reconciliation"),
        ],
      },
      {
        id: "reports",
        label: "Reports",
        featureRange: "F498-F505",
        items: [
          available("Trial Balance", "/accounting/trial-balance"),
          available("Profit & Loss", "/accounting/profit-loss"),
          available("Balance Sheet", "/accounting/balance-sheet"),
        ],
      },
      {
        id: "setup",
        label: "Setup",
        featureRange: "F506-F510",
        items: [
          adminOnly(
            "Accounting Settings",
            "/accounting/settings",
            "accounting.settings.manage",
          ),
        ],
      },
    ],
  },
];

export function getModuleNavigation(
  moduleKey: string,
): ModuleNavigation | null {
  return (
    MODULE_NAVIGATION.find((entry) => entry.moduleKey === moduleKey) ?? null
  );
}
